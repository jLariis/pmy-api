# Respaldo prod → local: visibilidad en vivo + velocidad

**Fecha:** 2026-09-10
**Repos afectados:** `pmy-api` (backend) y `app-pmy` (frontend)
**Rama actual:** `feat/consolidador-finanzas` (crear rama nueva para este trabajo)

## Problema

La herramienta "Respaldo de producción" (Configuración → superadmin) que trae la BD de
prod al MySQL local **tarda demasiado y a veces parece colgada**. El usuario **no tiene
visibilidad** de en qué fase se va el tiempo.

Causas detectadas en el código actual:

1. **Parece colgado.**
   - La barra de la fase *Restaurar* se mueve con **bytes leídos del `.gz`**, que el lector
     consume casi al instante, muy por delante de lo que `mysql` alcanza a aplicar. La barra
     llega a ~100 % y `mysql` sigue aplicando en silencio por minutos.
   - La cajita de logs solo muestra **`stderr` del cliente `mysql`**, que en un restore normal
     es **mudo** → la caja sale vacía → sensación de congelado.
2. **Restore lento.** El dump (`mysqldump`) ya trae `FOREIGN_KEY_CHECKS=0` y `UNIQUE_CHECKS=0`,
   pero **no agrupa los INSERT por transacción** ni desactiva el binlog local, así que cada
   lote hace commit+fsync y (si el binlog local está activo) se duplica el IO.

Nota de diseño: envolver TODO el restore en una sola transacción **no** funciona, porque el
dump emite `LOCK TABLES/UNLOCK TABLES` por tabla y eso hace *commit implícito*. La forma
correcta es batching **por tabla** desde el dump (`--no-autocommit`).

## Objetivo

- **Visibilidad en vivo** de qué está haciendo el restore, en la **misma pantalla** de
  Configuración (no una pantalla nueva): tabla actual, cronómetro por fase, heartbeat y
  resumen de tiempos al terminar. Que **nunca** parezca colgado.
- **Velocidad** con optimizaciones seguras e *inline* (misma sesión de MySQL, sin binarios
  nuevos como mydumper), aptas para una BD local desechable.
- Instrumentar de modo que los propios logs revelen dónde se va el tiempo, para decidir con
  datos si en el futuro hace falta algo más agresivo (mydumper/myloader queda **en reserva**,
  fuera de este spec).

## No-objetivos (YAGNI)

- No se introduce `mydumper`/`myloader` ni restore paralelo por tabla.
- No se cambia el mecanismo de autenticación ni el doble candado de seguridad
  (`BACKUP_ALLOW_RESTORE=1`, no-prod, `BACKUP_SECRET`).
- No se toca `streamDump` más allá de las flags de dump necesarias.

## Arquitectura (sin cambios estructurales)

Cadena existente que se conserva:

```
[prod] mysqldump --single-transaction --quick ... | gzip   (endpoint /server/backup/dump)
   → [local] fetch → archivo temp .sql.gz
   → gunzip → mysql (BD local)              (endpoint NDJSON /server/backup/restore-from-prod)
   → NDJSON de progreso → panel React (Configuración)
```

Se enriquecen: (a) las flags de dump/restore, (b) el stream de descompresión con un
passthrough que detecta tablas, (c) el protocolo NDJSON con más contexto, (d) el panel React.

## Cambios — Backend (`pmy-api`)

Archivo: `src/server-stats/backup.service.ts`

### Velocidad (bajo riesgo)

1. **Dump (`streamDump`, corre en prod):** agregar `--no-autocommit` a los argumentos de
   `mysqldump`. Esto envuelve los INSERT de **cada tabla** en una sola transacción
   (`SET autocommit=0; INSERT…; COMMIT;`), reduciendo commits/fsync. Se conservan
   `--single-transaction --quick --routines --triggers --events --no-tablespaces` y el
   charset utf8mb4.
2. **Restore (`restoreFile`, corre en local):** agregar
   `--init-command="SET sql_log_bin=0"` a los argumentos del cliente `mysql`, para **no
   escribir binlog** durante la carga. Se conserva `--max-allowed-packet=1073741824`.
3. **`innodb_flush_log_at_trx_commit=2` durante el restore:** antes de restaurar, leer el
   valor global actual (`SELECT @@GLOBAL.innodb_flush_log_at_trx_commit`), ponerlo en `2`, y
   **restaurar el valor original en el `finally`**. Todo dentro de try/catch: si falla por
   permisos, se registra un `log` de aviso y el restore continúa sin este ajuste (no rompe).

### Visibilidad

4. **Detección de tabla:** insertar un `Transform`/passthrough entre `gunzip` y `child.stdin`
   que escanee el SQL descomprimido por líneas y detecte el marcador
   `-- Dumping data for table \`X\``. Por cada marcador: incrementar un contador y emitir un
   evento `log` de nivel `table` con la línea `▶ [#N] Restaurando \`X\``. Manejar líneas
   partidas entre chunks con un buffer de cola (patrón `splitLines` ya existente, adaptado a
   stream). Extraer la detección a una función pura **`parseTableMarker(line): string | null`**
   para poder testearla.
5. **Heartbeat:** `setInterval` cada ~2 s mientras la fase es `restore`. En cada tick emitir un
   `log` de nivel `heartbeat`: `sigue trabajando · {elapsed}s · {MB} descomprimidos · tabla:
   \`X\``. Limpiar el intervalo en el `finally`/`close`.
6. **Cronómetro y resumen:** registrar `Date.now()` al entrar en cada fase. En el evento final
   `done`, incluir `timings: { connect, download, prepare, restore }` en ms. Helper puro
   **`summarizeTimings(marks): {phase, ms}[]`** testeable.
7. **Barra honesta:** durante `restore`, topar el porcentaje reportado en **95 %** hasta que el
   proceso `mysql` cierre con éxito; recién entonces emitir 100 %. (El feedback real de avance
   lo dan tabla actual + heartbeat + cronómetro, no la barra.)

### Protocolo NDJSON (retrocompatible)

Se extiende el evento `log` con campos **opcionales** `level` y `elapsedMs`, y `done` con
`timings`. El `.ps1` (`app-pmy/scripts/restore-from-prod.ps1`) sigue funcionando porque ignora
campos que no conoce; opcionalmente se le da color a los nuevos niveles (mejora menor).

```ts
type BackupEvent =
  | { type: 'step'; key: Phase; message: string; percent: number }
  | { type: 'progress'; phase: Phase; percent: number; bytes?: number; totalBytes?: number }
  | { type: 'log'; stream?: 'stdout'|'stderr'; level?: 'info'|'warn'|'phase'|'table'|'heartbeat'; line: string; elapsedMs?: number }
  | { type: 'done'; message: string; percent: number; timings?: Record<Phase, number> }
  | { type: 'error'; message: string };
```

### Caché de dump (opcional, apagado por defecto)

- El endpoint `restore-from-prod` acepta un flag opcional (query `?reuse=1`) que, si el temp
  `.sql.gz` previo existe y tiene **< 2 h**, **salta la descarga** y reusa ese archivo. Por
  defecto (sin flag) el comportamiento es idéntico al actual: descarga siempre fresco y borra
  el temp al final. El archivo cacheado se guarda con nombre estable (p. ej.
  `pmy-restore-cache.sql.gz` en `os.tmpdir()`), y **no** se borra en el `finally` cuando se usó
  caché. Emitir un `log` `phase` avisando "usando dump en caché (hace Xm)".

## Cambios — Frontend (`app-pmy`)

Archivos: `components/configuracion/server-backup-panel.tsx`,
`lib/services/server-backup.ts`. **Solo shadcn (`@/components/ui/*`) + Tailwind**, dentro del
panel existente (misma pantalla). Sin HTML crudo ni páginas nuevas.

1. **Tipos:** extender `BackupEvent` en `server-backup.ts` con `level`, `elapsedMs`, `timings`
   (espejo del backend). Agregar param opcional `reuseCache` a `streamRestoreFromProd` que
   añade `?reuse=1` a la URL.
2. **Consola en vivo** (reemplaza la cajita muda actual, mismo lugar del panel):
   - **Reloj de tiempo transcurrido** que corre en el front vía `setInterval` mientras
     `running` (independiente del backend, así nunca se ve congelado).
   - Encabezado con **fase actual + tabla actual** (derivados del último evento `table`).
   - Líneas con ícono/color por `level`: `phase` (azul), `table` (cian ▶), `warn`/stderr
     (ámbar), `heartbeat` (atenuado), `info` (gris). Autoscroll ya existe.
   - Al terminar, **resumen de tiempos por fase** (de `done.timings`): "Descarga 0:12 ·
     Restore 3:40".
3. **Toggle "Reutilizar dump reciente"**: un `Checkbox`/`Switch` de shadcn (default off) que
   pasa `reuseCache` al iniciar. Texto de ayuda: "Salta la descarga si hay un respaldo de
   menos de 2 h".

## Manejo de errores

- Se conserva el manejo actual de EPIPE en `child.stdin` y el corte de stream. El heartbeat y
  el intervalo del cronómetro se limpian siempre en `finally`.
- Restaurar `innodb_flush_log_at_trx_commit` en `finally` aunque el restore falle.
- Si `--init-command` o el `SET GLOBAL` fallan por permisos, degradar con un `log` `warn` y
  continuar (no abortar el restore).

## Pruebas

Archivo: `src/server-stats/backup.service.spec.ts` (ya existe, tiene tests de `computePercent`).

- `parseTableMarker`: reconoce `-- Dumping data for table \`shipment\``, ignora otras líneas,
  maneja backticks y nombres con guión bajo.
- `summarizeTimings`: convierte marcas de tiempo por fase en duraciones ordenadas.
- (Se mantienen los tests existentes de `computePercent`.)
- La orquestación de streams/procesos hijo no se testea unitariamente (integración con
  binarios); se cubre con los helpers puros + verificación manual en el panel.

## Verificación (manual, en la pantalla)

Con la API local corriendo y `BACKUP_ALLOW_RESTORE=1`:
1. Abrir Configuración → panel "Respaldo de producción" y disparar el restore.
2. Confirmar que la consola muestra tablas en vivo, heartbeat, reloj corriendo, y que la barra
   ya no se queda en 100 % colgada.
3. Al terminar, confirmar el resumen de tiempos por fase (revela el cuello real).
4. Probar el toggle de caché: segundo run con "Reutilizar dump reciente" debe saltar la
   descarga.

## Riesgos y mitigaciones

- **`--no-autocommit` cambia la salida del dump de prod:** es una flag estándar y solo afecta
  el agrupamiento transaccional; no cambia los datos. Bajo riesgo.
- **`SET GLOBAL` afecta todo el servidor local temporalmente:** se restaura siempre en
  `finally`; solo aplica en dev.
- **Caché sirviendo datos viejos:** mitigado con ventana de 2 h + aviso explícito en el log +
  default apagado.

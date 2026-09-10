# Restore rápido con recorte de historial (Spec A)

**Fecha:** 2026-09-10
**Repos afectados:** `pmy-api` (backend) y `app-pmy` (frontend)
**Rama:** `feat/respaldo-restore-recorte` (creada en ambos repos)
**Antecede a:** Spec B (respaldos nocturnos + gestión), que se diseñará por separado.

## Problema

El restore prod → local tarda ~40 min y a veces se necesita "atención súper rápida"
para revisar escenarios en local replicando prod. El cuello está confirmado: la tabla
**`shipment_status`** es un historial append-only con **millones de filas** (una fila por
evento de estatus por shipment/carga). El costo no es la descarga sino **reaplicar** esas
filas en el MySQL local.

## Objetivo

Bajar el tiempo del restore de ~40 min a ~2 min recortando el historial de
`shipment_status` a los **últimos 7 días** en el respaldo, **conservando TODOS los
shipments y cargas**. Sin huérfanos de FK (los padres se conservan completos). Mantener la
opción de respaldo completo para cuando se requiera fidelidad total.

## No-objetivos (YAGNI)

- No se implementan respaldos nocturnos ni gestión de artefactos (eso es Spec B).
- No se introduce respaldo físico (XtraBackup).
- Por ahora solo se recorta `shipment_status` (la tabla confirmada). El mecanismo queda
  extensible por si aparece otra tabla de historial gigante, pero no se agregan más ahora.

## Arquitectura

Se conserva toda la cadena y las optimizaciones ya existentes (descarga a temp, apply
rápido con `--init-command=SET sql_log_bin=0`, `innodb_flush_log_at_trx_commit=2`, consola
en vivo, cronómetro, peso real, caché opcional). Se agrega la generación de un **dump
recortado** en el lado de producción.

```
[prod] dump recortado (2 pasadas) | gzip     (GET /server/backup/dump?trimDays=7)
  → [local] fetch → temp .sql.gz → apply rápido → NDJSON → panel
```

### Dump recortado en 2 pasadas (`streamTrimmedDump`)

Un solo `mysqldump` no puede aplicar `--where` a una sola tabla, así que se generan dos
dumps concatenados al mismo stream gzip:

1. **Pasada 1 — todo excepto `shipment_status`:** `mysqldump … --ignore-table=<db>.shipment_status <db>`.
   Trae esquema + datos de todo lo demás, incluidos **todos** los shipments y cargas.
2. **Pasada 2 — solo `shipment_status` reciente:** `mysqldump …
   --where="createdAt >= NOW() - INTERVAL <days> DAY" <db> shipment_status`.
   Incluye el `CREATE TABLE` de `shipment_status` (create-info por defecto) + solo las filas
   de los últimos `<days>` días. Como la pasada 1 la ignoró por completo, su esquema aparece
   únicamente aquí.

Ambas pasadas conservan `--single-transaction --no-autocommit --quick --routines
--triggers --events --no-tablespaces --default-character-set=utf8mb4`. Cada pasada emite su
propio header que desactiva `FOREIGN_KEY_CHECKS`; al concatenar, el apply local desactiva
FK checks en cada bloque, y como los padres (shipments/cargas) se crean en la pasada 1, las
filas de `shipment_status` de la pasada 2 nunca quedan huérfanas.

Nota de orden: `--routines/--triggers/--events` se emiten **solo en la pasada 1** para no
duplicarlos; la pasada 2 usa `--skip-routines --skip-triggers --skip-events`.

### Configuración

```ts
// Tablas de historial que se recortan (por ahora solo una).
const HISTORY_TABLES: { table: string; dateColumn: string }[] = [
  { table: 'shipment_status', dateColumn: 'createdAt' },
];
```

`days` viene del request (`trimDays`, default 7). El endpoint `/server/backup/dump` acepta
`?trimDays=<n>`; si viene y es > 0, usa `streamTrimmedDump`, si no, el `streamDump`
completo actual. `restore-from-prod` acepta `?trim=<n>` y lo reenvía a la URL de prod como
`?trimDays=<n>`.

## Cambios — Backend (`pmy-api`)

Archivo: `src/server-stats/backup.service.ts`, `src/server-stats/backup.controller.ts`.

1. Helper puro **`buildDumpArgs(db, opts): string[]`** que arma los argumentos de una pasada
   de `mysqldump` (con `ignoreTable`, `whereClause`, `onlyTable`, flags de rutinas). Testeable.
2. **`streamTrimmedDump(res, days)`**: corre la pasada 1 (pipe a gzip → res) y, al cerrar
   con éxito, la pasada 2 (pipe al mismo gzip, `{ end: … }` cuidando de cerrar gzip solo al
   final). Reusa el manejo de errores de `streamDump` (child 'error'/'close', destroy).
3. Controller: `dump(@Res() res, @Query('trimDays') trimDays?)` → si `Number(trimDays) > 0`
   llama `streamTrimmedDump(res, n)`, si no `streamDump(res)`.
4. `restoreFromProd(res, reuse, trimDays?)`: si `trimDays` viene, la URL del dump de prod
   incluye `?trimDays=<n>` y se emite un `log` `phase`: "Respaldo recortado a N días de
   historial". Controller reenvía `?trim=<n>`.

## Cambios — Frontend (`app-pmy`)

Archivos: `lib/services/server-backup.ts`, `components/configuracion/server-backup-panel.tsx`.
Solo shadcn (`@/components/ui/*`) + Tailwind, en el panel existente.

1. `streamRestoreFromProd(onEvent, onEnd, signal, reuseCache?, trimDays?)`: agrega
   `?trim=<n>` a la URL cuando `trimDays` > 0.
2. Toggle **"Recorte de historial (7 días) — mucho más rápido"**, **encendido por
   defecto** (`trimDays = 7`). Apagado ⇒ respaldo completo (`trimDays = 0`, comportamiento
   actual). Un `Switch` de shadcn, deshabilitado mientras corre.
3. Nota visible cuando el recorte está activo: "El historial de estatus se recorta a los
   últimos 7 días (los shipments se conservan completos)."

## Manejo de errores

- Si cualquier pasada de `mysqldump` falla, se corta el stream igual que hoy
  (`res.destroy`), y el restore local reporta el error real vía NDJSON.
- Si el header `content-length` no viene (dump en streaming), el peso real de la BD ya lo
  da el endpoint `/size`; la barra usa ese tamaño (aunque el recorte hará que se aplique
  menos, así que la barra puede llegar al 99% algo antes — aceptable, la consola en vivo y
  el cronómetro dan el detalle).

## Pruebas

Archivo: `src/server-stats/backup.service.spec.ts`.

- `buildDumpArgs` pasada 1: incluye `--ignore-table=<db>.shipment_status`, las rutinas y NO
  incluye `--where`.
- `buildDumpArgs` pasada 2: incluye `--where=createdAt >= NOW() - INTERVAL 7 DAY`, el nombre
  de tabla `shipment_status`, y `--skip-routines --skip-triggers --skip-events`.
- Se mantienen los tests existentes (`computePercent`, `parseTableMarker`, `summarizeTimings`).

## Verificación (manual, en la pantalla)

1. Con API local y `BACKUP_ALLOW_RESTORE=1`, disparar el restore con el toggle de recorte
   **encendido**.
2. Confirmar el `log` "Respaldo recortado a 7 días…", que `shipment_status` se aplica en
   segundos (no minutos) y que el tiempo total baja drásticamente.
3. Verificar que los shipments siguen completos en local (misma cantidad que prod) pero su
   `statusHistory` solo trae los últimos 7 días.
4. Apagar el toggle y confirmar que el respaldo completo sigue funcionando.

## Riesgos y mitigaciones

- **Inconsistencia entre pasadas:** cada pasada es su propia transacción; en el ínterin
  podrían entrar filas nuevas. Para un respaldo de desarrollo es aceptable.
- **Otra tabla de historial gigante:** si aparece, se agrega a `HISTORY_TABLES` (el motor ya
  la soportaría, pero requeriría generalizar el 2-pass a N tablas ignoradas; fuera de este
  spec).

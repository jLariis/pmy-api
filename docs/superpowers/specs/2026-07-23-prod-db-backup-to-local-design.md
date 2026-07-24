# Respaldo producción → MySQL local (Configuración → Servidor)

Fecha: 2026-07-23
Estado: aprobado, en implementación inline

## Objetivo

Permitir al superadmin, **desde la UI de desarrollo**, traer un respaldo completo de la
base de datos de producción (`pmy-db`) y restaurarlo en su MySQL local, con un solo clic,
viendo el progreso y los logs en vivo. Sin dejar registro de auditoría. Bajo demanda.

La BD usa **MySQL** (driver `mysql2` + TypeORM), por lo que el respaldo es un `mysqldump`
(`.sql.gz`), no `.bak`.

## Restricciones y contexto

- La conexión directa al MySQL de producción usa una **IP pública que cambia** cada cierto
  tiempo. Por eso NO se conecta directo al puerto MySQL de prod: se pasa por el **API de
  producción, que sí tiene dominio estable**: `https://api.paqueteriaymensajeriadelyaqui.com/api`.
- La BD siempre se llama `pmy-db` (origen y destino).
- La restauración es **exclusiva de desarrollo**: nunca debe poder ejecutarse contra prod.
- Ya existe un área `/server` (controlador `ServerStatsController`) protegida con
  `SuperAdminGuard`, con streaming NDJSON de logs (`ServerLogsService.streamTo`) y el
  decorador `@NoAudit()`. El nuevo trabajo reutiliza esos patrones.

## Arquitectura

Un solo código desplegado en prod y corriendo en local; el rol lo determina el entorno.

### Backend (`pmy-api`) — nuevo `BackupModule` bajo `/server/backup`

**1. `GET /server/backup/dump`** — rol ORIGEN (se usa el que corre en prod)
- Auth: `SuperAdminGuard` **o** header `X-Backup-Secret: <BACKUP_SECRET>` (para llamadas
  server-to-server desde el backend local). `@NoAudit()`.
- Ejecuta `mysqldump` de la BD a la que ese proceso está conectado (en prod = `pmy-db` de
  producción). Flags: `--single-transaction --quick --routines --triggers --events
  --no-tablespaces --default-character-set=utf8mb4`.
- Pasa la salida por `gzip` y la transmite como `.sql.gz` en **streaming** (transferencia
  continua, así los timeouts por inactividad del proxy no la cortan).
- La contraseña se pasa por la variable de entorno `MYSQL_PWD` al proceso hijo, **nunca**
  en argumentos de línea de comando ni en logs.

**2. `POST /server/backup/restore-from-prod`** — rol DESTINO (SOLO-DEV)
- **Candado duro**: rechaza (403) si `NODE_ENV === 'production'` o si no está
  `BACKUP_ALLOW_RESTORE=1`. Es físicamente incapaz de sobrescribir producción.
- Pasos:
  1. Llama `PROD_API_URL + /server/backup/dump` con `X-Backup-Secret`.
  2. Descarga el `.sql.gz` a un archivo temporal.
  3. `CREATE DATABASE IF NOT EXISTS \`pmy-db\`` en el MySQL local.
  4. Restaura con el cliente `mysql` (lee el gz descomprimido) contra la BD local.
  5. Borra el archivo temporal.
- Responde en **NDJSON** con eventos:
  - `{ type: 'step', key, message }` — inicio de una fase.
  - `{ type: 'progress', phase, percent, bytes?, totalBytes? }` — para la barra de progreso.
  - `{ type: 'log', stream: 'stdout'|'stderr', line }` — salida cruda de los procesos.
  - `{ type: 'done', message }` — éxito.
  - `{ type: 'error', message }` — fallo (se renderiza en rojo).

### Barra de progreso

- Modelo de **fases con peso** para un porcentaje global 0–100:
  1. `connect` (llamada a prod) — 5%
  2. `download` (descarga del dump) — 55%: si la respuesta de prod trae `Content-Length`,
     el porcentaje de esta fase es determinado por bytes; si no, indeterminado (spinner).
  3. `prepare` (CREATE DATABASE) — 5%
  4. `restore` (import con `mysql`) — 35%: determinado por bytes leídos del dump vs. tamaño
     total del archivo temporal.
- El backend emite `progress` con `percent` global ya calculado; la UI solo pinta la barra
  y muestra el contador de bytes cuando exista.

### Variables de entorno nuevas

| Variable | Dónde | Descripción |
|---|---|---|
| `BACKUP_SECRET` | prod + local | Secreto compartido para `X-Backup-Secret`. |
| `PROD_API_URL` | local | Default `https://api.paqueteriaymensajeriadelyaqui.com/api`. |
| `BACKUP_ALLOW_RESTORE` | solo local | `1` habilita el restore. Ausente = deshabilitado. |
| `MYSQLDUMP_BIN` | prod (opcional) | Ruta a `mysqldump` si no está en el PATH. |
| `MYSQL_BIN` | local (opcional) | Ruta al cliente `mysql` si no está en el PATH. |

La BD objetivo por defecto es `pmy-db`; el host/usuario/password locales salen del
`DB_*` existente.

### Frontend (`app-pmy`, repo separado) — Configuración → Servidor

- Tarjeta "Respaldo de producción" con:
  - Badge **"Solo desarrollo"**.
  - Botón **"Traer producción → local"** (deshabilitado mientras corre).
  - **Barra de progreso** (0–100%) + etiqueta de fase actual + contador de bytes.
  - Panel de **log en vivo** que renderiza los eventos NDJSON (pasos, líneas stdout/stderr,
    éxito en verde, error en rojo).
- La tarjeta solo se muestra/activa cuando el backend indica que está en modo desarrollo
  (endpoint o flag de capacidad).

## Seguridad

- El dump solo lo obtiene superadmin (JWT) o quien tenga el `BACKUP_SECRET`.
- El restore es incapaz de correr en producción (doble candado: `NODE_ENV` +
  `BACKUP_ALLOW_RESTORE`).
- La contraseña de la BD nunca aparece en argumentos ni en el log en vivo.
- `@NoAudit()` en ambos endpoints: no queda registro de uso.

## Pruebas

- Unit: construcción del comando `mysqldump`/`mysql` (verificar que NO incluye el password
  en args y que usa `MYSQL_PWD`).
- Unit: guard dev-only rechaza cuando `NODE_ENV=production` o falta `BACKUP_ALLOW_RESTORE`.
- Unit: cálculo del `percent` global por fases y pesos.
- Unit: aceptación de auth por `X-Backup-Secret` y por `SuperAdminGuard`.

## Fuera de alcance (YAGNI)

- Programación/automatización de respaldos (solo bajo demanda).
- Historial o registro de respaldos.
- Selección parcial de tablas.
- Backup de local → prod (dirección inversa nunca).

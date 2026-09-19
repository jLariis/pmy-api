# Suspensión / Despertar programado del servidor (Configuración → Servidor)

- **Fecha:** 2026-09-18
- **Autor:** Javier Laris (con Claude)
- **Estado:** Aprobado (pendiente de revisión del spec)
- **Repos afectados:** `pmy-api` (backend + provisioning), `app-pmy` (UI)

## 1. Objetivo

Permitir que el **superadmin** configure, desde **Configuración → Servidor**, que el
servidor Ubuntu **físico (bare metal)**:

- se **suspenda** automáticamente a una hora (default **21:30**), las noches de
  **lunes a sábado** (días editables),
- **despierte solo** a una hora (default **06:00**) la mañana siguiente a cada suspensión,
- envíe **alertas por correo** cuando **se suspende** y cuando **despierta**, a una lista
  de destinatarios editable (sembrada con
  `javier.rappaz@gmail.com`, `josejuanurena@paqueteriaymensajeriadelyaqui.com`,
  `sistemas@paqueteriaymensajeriadelyaqui.com`).

Los horarios/días/destinatarios se **guardan en BD** (fuente de verdad) y al guardarse
**modifican de verdad** la programación del SO.

## 2. Principio rector

El **SO hace el suspend/wake real** con `systemd` + `rtcwake` (confiable aunque Node se
reinicie). La **app solo persiste la config en BD, la aplica al SO** vía un único comando
`sudo` acotado, y **envía los correos** con el `MailService` existente vía hooks locales.

## 3. Mecanismo de despertar (detalle crítico)

`rtcwake -m mem` suspende por sysfs y **NO** dispara los hooks de `systemd` (perderíamos
los correos). Por eso el script usa **dos pasos**:

```bash
rtcwake -m no -t <epoch del próximo wakeTime>   # SOLO arma la alarma del RTC (hardware)
systemctl suspend                                # suspende por la vía systemd (dispara hooks → correos)
```

**Salvaguarda:** si no logra armar la alarma RTC (p. ej. no existe `/sys/class/rtc/rtc0`),
**NO** ejecuta `systemctl suspend` (evita dejar el servidor dormido para siempre) y lo
registra en journald.

El wake queda naturalmente atado a cada suspensión: solo se arma la alarma al suspender,
así que solo despierta las mañanas siguientes a una noche de suspensión.

## 4. Arquitectura

```
[UI app-pmy: Configuración → Servidor]  (superadmin)
        │  PUT /server/power/schedule
        ▼
[pmy-api  ServerPowerService]
   1. valida DTO (TS)
   2. guarda en BD  (server_power_schedule)   ← FUENTE DE VERDAD
   3. deriva /var/lib/pmy-power/desired.json
   4. sudo /usr/local/sbin/pmy-power-apply     ← reescribe timer + schedule.env, daemon-reload, restart timer
   5. registra lastAppliedAt / lastApplyError en BD
        │
        ▼
[SO / systemd]
   pmy-power-suspend.timer  (OnCalendar=<días> <suspendTime>)
        └─> pmy-power-suspend.service
                └─> /usr/local/sbin/pmy-power-suspend
                        rtcwake -m no -t <wake> ; systemctl suspend
   /usr/lib/systemd/system-sleep/pmy-power
        pre  suspend → POST http://127.0.0.1:PORT/server/power/internal/notify {event:"suspend"}
        post suspend → (espera red) POST .../notify {event:"wake"}
        │
        ▼
[pmy-api  notify]  → MailService.sendEmailNotification(recipients de BD)
```

## 5. Capa BD (pmy-api)

### 5.1 Entidad `ServerPowerSchedule` (single-row, patrón `CompanySettings`)

Archivo `src/entities/server-power-schedule.entity.ts`, exportada en `src/entities/index.ts`.
Tabla `server_power_schedule`. Guarda la config **global** (los días viven en su propia
tabla, §5.2).

| Columna         | Tipo                    | Notas |
|-----------------|-------------------------|-------|
| `id`            | uuid PK                 | |
| `enabled`       | `bit(1)`→boolean (transformer existente) | default `true` |
| `suspendTime`   | `varchar(5)`            | `HH:MM`, default `21:30` |
| `wakeTime`      | `varchar(5)`            | `HH:MM`, default `06:00` |
| `recipients`    | `json`                  | array de emails; default los 3 sembrados |
| `lastAppliedAt` | `datetime` null         | última aplicación exitosa al SO |
| `lastApplyError`| `text` null             | stderr/mensaje del último apply fallido (null si OK) |
| `updatedById`   | `varchar` null          | id del superadmin que guardó |
| `createdAt`/`updatedAt` | timestamps       | patrón del repo |

Reutiliza el transformer `bit(1)→boolean` de `subsidiary.entity.ts`.

### 5.2 Entidad `ServerPowerDay` (**una fila por día**)

Archivo `src/entities/server-power-day.entity.ts`, exportada en `src/entities/index.ts`.
Tabla `server_power_day`. **7 filas fijas**, una por día de la semana.

| Columna       | Tipo                    | Notas |
|---------------|-------------------------|-------|
| `id`          | uuid PK                 | |
| `dayOfWeek`   | `tinyint` **UNIQUE**    | ISO weekday: 1=Lun … 7=Dom |
| `active`      | `bit(1)`→boolean        | ¿se suspende esa noche? default `true` para 1–6, `false` para 7 |

Estructura normalizada: deja la puerta abierta a horarios por día en el futuro sin
re-migrar (columnas `suspendTime`/`wakeTime` opcionales por fila). Por ahora las horas son
globales (§5.1); estas filas solo prenden/apagan cada día.

### 5.3 Migración `1786000000073-CreateServerPowerSchedule.ts`

- Crea `server_power_schedule` y `server_power_day`.
- Inserta la **fila única** de settings (enabled=1, 21:30, 06:00, los 3 correos).
- Inserta las **7 filas** de `server_power_day` (1–6 `active=1`, 7 `active=0`).
- `DB_SYNC=false` en todos los entornos (regla del repo): el esquema SOLO por migración.
- `down()` hace `DROP TABLE` de ambas.

## 6. Capa App (pmy-api)

Nuevo submódulo `src/server-stats/power/` (o `ServerPowerModule`), montado en el
controlador `server` existente (`@UseGuards(SuperAdminGuard)`).

### 6.1 Endpoints

| Método | Ruta | Guard | Descripción |
|--------|------|-------|-------------|
| `GET`  | `/server/power/schedule` | SuperAdmin | Devuelve la config de BD + estado (`nextSuspend`, `nextWake` derivados; `timerActive` leyendo `systemctl is-active`), `lastAppliedAt`, `lastApplyError`. |
| `PUT`  | `/server/power/schedule` | SuperAdmin (auditado) | Valida, **guarda en BD**, deriva `desired.json`, corre `sudo pmy-power-apply`; si falla → `500` con stderr y guarda `lastApplyError` (nunca finge éxito). |
| `POST` | `/server/power/suspend-now` | SuperAdmin | Suspende el servidor **de inmediato** (`sudo pmy-power-suspend-now`): arma el RTC al próximo `wakeTime` (nunca duerme sin despertador), ignora el flag `enabled`. El correo "se suspendió" lo dispara el hook. UI con confirmación doble. |
| `POST` | `/server/power/test-email` | SuperAdmin | Manda correo de prueba a los recipients actuales. |
| `POST` | `/server/power/internal/notify` | **PowerSecretGuard** (header `X-Power-Secret`, estilo `backup-secret.guard.ts`) — **no** SuperAdmin | Body `{event:'suspend'\|'wake'}`. Lee recipients de BD y manda el correo. Solo localhost. |

### 6.2 Validación (DTO, `class-validator`)

- `enabled`: boolean.
- `suspendTime`, `wakeTime`: regex `^([01]\d|2[0-3]):[0-5]\d$`.
- `days`: array no vacío de enteros únicos en `1..7` (el service lo mapea a los flags
  `active` de las 7 filas de `server_power_day`).
- `recipients`: array no vacío; cada uno `@IsEmail`.

### 6.3 Derivación a `desired.json`

`ServerPowerService.applyToOs()` construye `days` a partir de las filas `active` de
`server_power_day` y escribe `/var/lib/pmy-power/desired.json`
(dir propiedad del usuario de la app):

```json
{ "enabled": true, "suspendTime": "21:30", "wakeTime": "06:00",
  "days": [1,2,3,4,5,6] }
```

Luego ejecuta `sudo /usr/local/sbin/pmy-power-apply` (vía `spawn`, patrón de
`backup.service.ts`). Recipients y secreto NO van al SO (los correos los manda la app; el
hook solo dispara el endpoint con `X-Power-Secret`).

### 6.4 Correos

Reutiliza `MailService.sendEmailNotification({ to, subject, htmlContent })`. Dos plantillas
simples (suspend/wake) con hostname, hora local MX y próximo evento.

## 7. Capa SO — provisioning (pmy-api `deploy/`)

`deploy/setup-power-schedule.sh` (idempotente, se corre una vez con `sudo`; parametrizado por
`APP_USER`, `APP_PORT`, y genera/lee `POWER_SECRET`). Instala:

- `/usr/local/sbin/pmy-power-suspend-now` — núcleo: arma RTC (`rtcwake -m no -t`) al próximo
  `wakeTime` de `schedule.env`; si OK → `systemctl suspend`; si no hay RTC → aborta y loguea.
  Lo usa el botón "Suspender ahora" (vía `sudo`) e, indirectamente, el timer.
- `/usr/local/sbin/pmy-power-suspend` — vía del timer: respeta `ENABLED` y delega en
  `pmy-power-suspend-now`.
- `/usr/local/sbin/pmy-power-apply` — lee `desired.json`, **revalida estricto** (HH:MM, días
  1..7), reescribe el drop-in `OnCalendar` del timer + `/etc/pmy-power/schedule.env`,
  `systemctl daemon-reload`, `systemctl reenable --now pmy-power-suspend.timer` (o lo detiene
  si `enabled=false`). Mapea ISO days → tokens systemd (`1→Mon … 7→Sun`).
- `/usr/lib/systemd/system-sleep/pmy-power` — hook `pre/post`: `curl -m N -H X-Power-Secret`
  al endpoint `internal/notify`; en `post` reintenta hasta tener red.
- `/etc/systemd/system/pmy-power-suspend.{service,timer}`.
- `/etc/pmy-power/` (root) y `/var/lib/pmy-power/` (chown `APP_USER`).
- `/etc/sudoers.d/pmy-power`: `APP_USER ALL=(root) NOPASSWD: /usr/local/sbin/pmy-power-apply, /usr/local/sbin/pmy-power-suspend-now`
  (validado con `visudo -c`).
- Añade `POWER_SECRET`/`POWER_NOTIFY_PORT` al `.env` de la app si no existen.

`deploy/README-power-schedule.md` documenta instalación, variables y verificación
(`rtcwake -m no -t $(date -d '+2 min' +%s)` de prueba).

## 8. Capa UI (app-pmy — repo separado)

House rules: `AppLayout` + `withAuth` + `OperationHeader`, **solo** shadcn (`@/components/ui/*`)
+ Tailwind; lenguaje llano. Sección **Servidor** en Configuración:

- Switch "Suspensión automática".
- Time pickers: "Se suspende a las" / "Despierta a las".
- Checkboxes de días (L M M J V S D), default L–S.
- Lista editable de correos (chips/inputs), sembrada con los 3.
- Botón **Guardar** (solo superadmin) → `PUT`.
- Estado: próximo apagado / próximo encendido, última aplicación, y error si lo hubo.
- Botón "Enviar correo de prueba".
- Botón **"Suspender ahora"** (destructivo) con diálogo de confirmación doble → `POST /server/power/suspend-now`.

## 9. Manejo de errores

- Validación **doble**: TS en la app (tests) + defensiva en `pmy-power-apply` (rechaza
  entradas malformadas → nada de inyección en unit files).
- `apply` fallido → `500` honesto + `lastApplyError` en BD; la UI muestra el error.
- Correos best-effort: reintento en resume, log en journald si la app no responde.
- **Nunca** suspender sin alarma RTC armada.

## 10. Pruebas

- **Jest (pmy-api):** validación de `suspendTime/wakeTime/days/recipients`; derivación de
  `desired.json`; `notify` (rechaza sin/incorrecto `X-Power-Secret`, llama al mailer con los
  recipients de BD); `PropagateApplyError` (apply falla → 500 + guarda error).
- `pmy-power-apply` revalida (prueba manual/bats documentada).
- Provisioning idempotente (se puede correr 2 veces sin romper).

## 11. Entregables

1. **pmy-api:** entidad + migración `073` + módulo `power` (endpoints, DTO, service, guard) +
   plantillas de correo + `deploy/setup-power-schedule.sh` + unidades/scripts + README + tests.
2. **app-pmy:** pantalla Configuración → Servidor.

## 12. Fuera de alcance (YAGNI)

- Wake-on-LAN / API de hipervisor (es bare metal).
- Múltiples ventanas de suspensión por día.
- Historial largo de eventos en BD (basta journald + auditoría del PUT).

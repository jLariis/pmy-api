# Trazabilidad y reenvío de correo — piloto en Salidas a Ruta

Fecha: 2026-08-06
Estado: Aprobado para planeación
Autor: Javier (con asistencia de Claude)

## 1. Problema

Cuando se hace una "Salida a Ruta" (`package-dispatch`), el sistema envía un correo con dos
adjuntos (PDF y Excel) a la sucursal. Hoy:

- No hay forma de saber si ese correo realmente salió, a quién, cuándo, ni qué pasó si falló.
- Si el envío falla, el request revienta con 500 y la falla se pierde: nadie se entera ni
  puede corregirla.
- No existe forma de reenviar el correo desde el historial.

Queremos **trazabilidad completa** del envío de correo y la capacidad de **reenviar** desde el
historial de salidas. Esto se diseñará **genérico** para poder adoptarse en todos los módulos,
pero **solo se cablea a `package-dispatch`** como piloto en esta iteración.

## 2. Contexto técnico relevante

- **Backend**: NestJS + TypeORM sobre **MySQL**. Deploy en **Ubuntu Server 24.04** (VPS con
  **disco persistente**; el `vercel.json` del repo es legacy y no refleja el runtime real).
  Los adjuntos se guardan **en disco**, no en la base de datos, para no inflarla. La BD solo
  guarda la ruta + metadatos del archivo.
- **Almacenamiento en disco (patrón ya existente)**: `main.ts` sirve `uploads/` como estático
  (`express.static(join(process.cwd(), 'uploads'))`) y `support.controller.ts` guarda en
  `uploads/support/` con `multer diskStorage`. Reusamos ese patrón: los adjuntos de correo van
  a `uploads/email/<module>/<entityId>/<filename>` (relativo a `process.cwd()`). El operador
  (Javier) mantiene y purga esta carpeta con el tiempo.
- **Esquema**: se maneja por **migraciones** (`src/database/migrations`), no por `synchronize`
  en producción. Todo cambio de esquema va en una migración nueva.
- **Flujo de correo actual**:
  - El frontend genera PDF (`@react-pdf/renderer`) y Excel (`generateDispatchExcelClient`) y
    los sube a `POST /package-dispatchs/upload` (`package-dispatch.controller.ts`).
  - `PackageDispatchService.sendByEmail` recibe ambos archivos y llama a
    `MailService.sendHighPriorityPackageDispatchEmail`.
  - `MailService` arma los adjuntos, renderiza la plantilla `route_dispatch`, calcula
    destinatarios y despacha vía `this.dispatch()` (nodemailer). Hoy **no devuelve** el
    resultado y **relanza** la excepción si falla.
  - `MailService.applyDevFilters` redirige todos los correos a un correo de prueba cuando
    `NODE_ENV === 'dev'`.
  - Destinatarios: `subsidiary.officeEmail` (to) + `subsidiary.officeEmailToCopy` +
    `sistemas@...` (cc).
  - El backend **ya puede regenerar** ambos documentos por su cuenta con
    `renderRouteDispatchDocuments` (motor de plantillas), detrás del flag
    `DOC_ENGINE_ROUTE_DISPATCH`. Esto se usa como *fallback* para reenvíos de despachos
    históricos que no tengan adjuntos guardados.
- **Frontend**: Next.js. El historial vive en
  `components/package-dispatch/package-dispatch-control.tsx` (columna de acciones) alimentado
  por `findAllBySubsidiary`. El servicio es `lib/services/package-dispatchs.ts`.

## 3. Decisiones tomadas

1. **Fuente de los adjuntos en el reenvío**: se **guardan los archivos en el primer envío** y el
   reenvío usa exactamente esos mismos bytes (fidelidad 100%). Almacenamiento: **en disco** bajo
   `uploads/email/...`; la BD guarda solo la ruta + metadatos (no los bytes), para no inflarla.
   Como el operador purga archivos viejos con el tiempo, el reenvío de una salida cuyo archivo ya
   no exista en disco usa el *fallback* de regeneración (ver 5.3).
2. **Fallo en el primer envío**: **no revienta** el request. El despacho se crea/queda igual, el
   correo fallido se registra como `ERROR`, y el botón (rojo) permite reenviar.
3. **Filtro de ambiente dev**: el reenvío **respeta `applyDevFilters`** igual que el resto del
   sistema (en dev va al correo de prueba; en prod a los reales).
4. **"Enviado" = aceptado por el SMTP** (nodemailer `accepted`/sin `rejected`). No hay
   confirmación de entrega ni de lectura; eso queda fuera de alcance.

## 4. Modelo de datos

Todo se crea en una migración nueva: `AddEmailDeliveryTracking`.

### 4.1 `email_log` (entidad `EmailLog`) — genérica

Un renglón por **cada intento** de envío (primer envío y cada reenvío).

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `module` | varchar | discriminador, p.ej. `'package_dispatch'` |
| `emailType` | varchar, default `'unknown'` | tipo/origen del correo (de dónde salió): `route_dispatch`, `unloading`, `route_closure`, `inventory`, `devolutions`, … (suele coincidir con la clave de plantilla) |
| `entityId` | varchar | id de la entidad origen (polimórfico, sin FK dura) |
| `referenceTracking` | varchar nullable | folio/guía legible de la entidad origen (p.ej. `trackingNumber` del despacho) |
| `subsidiaryId` | varchar nullable | sucursal a la que corresponde el correo |
| `subsidiaryName` | varchar nullable | nombre de la sucursal (denormalizado para mostrar sin joins) |
| `to` | text | destinatarios reales usados (ya con filtro dev aplicado) |
| `cc` | text nullable | |
| `subject` | varchar | |
| `status` | enum `SENT \| ERROR` | |
| `error` | text nullable | mensaje completo del error |
| `messageId` | varchar nullable | de la respuesta SMTP |
| `rejected` | text nullable | direcciones rechazadas por el SMTP, si hubo |
| `isResend` | boolean, default false | |
| `triggeredById` | uuid nullable | usuario que realizó el envío/reenvío |
| `triggeredByName` | varchar nullable | nombre del usuario (denormalizado) |
| `attachmentsMeta` | json | `[{ filename, size }]` para mostrar sin cargar bytes |
| `createdAt` | timestamp | hora del envío |

Índices: `(module, entityId, createdAt)` y `(emailType)`. El **actor** (usuario) se toma de
`req.user` (`userId`, `name`/`lastName`, `email`) tanto en el primer envío como en el reenvío.

Índice: `(module, entityId, createdAt)` para consultar el historial de una entidad.

### 4.2 `email_attachment` (entidad `EmailAttachment`) — genérica

Referencia a los archivos guardados **en disco**, una sola vez por entidad. Los reenvíos leen
del disco por esta ruta; no se duplican. **La BD no guarda los bytes.**

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `module` | varchar | |
| `entityId` | varchar | |
| `filename` | varchar | nombre original del archivo |
| `mimeType` | varchar | |
| `size` | int | tamaño en bytes (para mostrar/validar) |
| `storagePath` | varchar | ruta **relativa** a `process.cwd()`, p.ej. `uploads/email/package_dispatch/<id>/<file>` |
| `createdAt` | timestamp | |

Índice: `(module, entityId)`. La ruta es relativa para que sobreviva a cambios de working dir
del proceso; se resuelve con `join(process.cwd(), storagePath)` al leer.

### 4.3 Columnas denormalizadas en `package_dispatch`

La "propiedad nueva en la entidad" que pide el requerimiento, para pintar el botón en el
listado sin joins pesados:

| Columna | Tipo | Notas |
|---|---|---|
| `emailStatus` | enum `NOT_SENT \| SENT \| ERROR`, default `NOT_SENT` | |
| `emailLastSentAt` | timestamp nullable | |
| `emailLastError` | varchar(500) nullable | resumen; el detalle completo vive en `email_log` |

Las filas existentes quedan en `NOT_SENT` por el default de la migración.

## 5. Backend — diseño de componentes

### 5.1 `EmailLogService` (nuevo, genérico, en `src/mail` o `src/email-log`)

No conoce `package_dispatch`; opera solo por `(module, entityId)`.

- `persistAttachments(module, entityId, files): Promise<void>` — escribe los archivos a
  `uploads/email/<module>/<entityId>/` (crea la carpeta con `mkdir recursive`) y registra un
  renglón `email_attachment` por archivo con su `storagePath` relativo. Idempotente: si ya hay
  registros para esa entidad, no duplica (reemplaza carpeta/registros o no-op).
- `loadAttachments(module, entityId): Promise<{ filename, content: Buffer }[] | null>` — lee de
  disco los archivos registrados. Devuelve `null` si no hay registros **o si algún archivo ya no
  existe en disco** (fue purgado), para que el llamador dispare el *fallback*.
- `record(entry): Promise<EmailLog>` — escribe un renglón de log.
- `getHistory(module, entityId): Promise<EmailLog[]>` — ordenado por `createdAt` desc.

### 5.2 `MailService` (cambios mínimos)

- `sendHighPriorityPackageDispatchEmail(...)` pasa a **devolver** el resultado de nodemailer
  (`{ accepted, rejected, messageId }`) en vez de solo `await`. Sigue relanzando en excepción
  dura; el orquestador la atrapa. `rejected` no vacío ⇒ se trata como `ERROR`.
- Se refactoriza `sendHighPriorityPackageDispatchEmail` para aceptar los adjuntos como
  `{ filename, content: Buffer }[]` (además del path actual con `Express.Multer.File`) para
  poder reenviar desde bytes guardados sin fabricar objetos Multer falsos. Se mantiene el
  cálculo de destinatarios y `applyDevFilters` intactos.

### 5.3 `PackageDispatchService`

- `sendByEmail(pdf, excel, subsidiaryName, dispatchId, actor?, isResend=false)` — vía única de
  (re)envío. Tanto el primer envío como el **reenvío** pasan por aquí (el frontend sube los
  archivos en ambos casos; el reenvío marca `isResend=true`):
  1. `emailLogService.persistAttachments('package_dispatch', dispatchId, [pdf, excel])`.
  2. Intenta enviar; captura resultado o excepción.
  3. `emailLogService.record({...})` con `SENT` o `ERROR` (incluye tipo/origen, folio, sucursal,
     `to`, `cc`, `subject`, `error`, `messageId`, `rejected`, `attachmentsMeta`, `isResend`,
     `triggeredById`/`triggeredByName`).
  4. Actualiza `emailStatus`/`emailLastSentAt`/`emailLastError` en el despacho.
  5. **No relanza**: devuelve `{ status, error?, to? }` para que el front informe.
- `getEmailHistory(dispatchId)`: delega en `emailLogService.getHistory`.
- `findAllBySubsidiary`: agrega `pd.emailStatus`, `pd.emailLastSentAt`, `pd.emailLastError` al
  `select` del listado.

> **Nota (corrección post-diseño):** el reenvío NO se hace regenerando en el backend. El PDF
> real solo lo produce el cliente (`@react-pdf/renderer`); el motor de plantillas del backend
> (`route_dispatch_pdf`) no entrega un buffer PDF en este entorno, así que un reenvío backend
> mandaba un correo parcial (solo Excel). Se eliminaron `resendEmail`,
> `regenerateAndPersistAttachments` y el endpoint `POST /resend-email`. El reenvío ahora
> **regenera PDF+Excel en el cliente y sube por `/upload`** con `isResend=true`. `loadAttachments`
> se conserva (genérico) por si a futuro un módulo sí puede regenerar en backend.

### 5.4 `PackageDispatchController` (endpoints)

- `POST /package-dispatchs/upload` → `sendByEmail(...)` con `isResend` opcional (primer envío
  **y** reenvío).
- `GET /package-dispatchs/:id/email-history` → `getEmailHistory(id)`.

## 6. Frontend — diseño

En `package-dispatch-control.tsx`, columna de acciones, nuevo botón **Reenviar correo**:

- **Color** según `row.original.emailStatus`: verde = `SENT`, rojo = `ERROR`, gris = `NOT_SENT`.
- **Tooltip**:
  - `SENT`: "Correo enviado el {emailLastSentAt} a {destinatarios}".
  - `ERROR`: "Error: {emailLastError}".
  - `NOT_SENT`: "Aún no se ha enviado el correo".
- **Click** → abre un diálogo con el **historial de envíos** (status, para quién `to`/`cc`,
  hora, error si hubo) obtenido de `GET /email-history`, y un botón **Reenviar** con
  confirmación. Al reenviar: llama `POST /resend-email`, muestra toast del resultado, y
  refresca el listado (`mutate()`).

Servicios nuevos en `lib/services/package-dispatchs.ts`:
- `resendDispatchEmail(id): Promise<{ status, error? }>`
- `getDispatchEmailHistory(id): Promise<EmailLogDto[]>`

Tipos: extender `PackageDispatch` (listado) con `emailStatus`, `emailLastSentAt`,
`emailLastError`; agregar `EmailLogDto`.

## 7. Testing

- **Unit** (`EmailLogService`): `persistAttachments` escribe a disco + registra ruta y es
  idempotente; `loadAttachments` devuelve `null` cuando falta un archivo en disco; `record`
  escribe el status correcto; lógica `SENT` vs `ERROR` cuando `rejected` no está vacío. Se usa
  un directorio temporal como raíz de `uploads` en los tests (no tocar el real).
- **Integration** (patrón `*.integration.spec.ts` del módulo):
  - Primer envío OK ⇒ `emailStatus = SENT`, se crea `email_log`, se escriben archivos en disco
    + registro `email_attachment`.
  - Envío que falla ⇒ `emailStatus = ERROR`, se registra el log, **el request no revienta**.
  - Reenvío ⇒ usa archivos guardados en disco, agrega `email_log` con `isResend = true`.
  - Reenvío con archivos ausentes/purgados ⇒ **fallback** regenera, persiste y envía.

## 8. Fuera de alcance (YAGNI)

- Cola de envío / reintentos automáticos.
- Confirmación de entrega o de lectura (solo registramos "aceptado por SMTP").
- Edición de destinatarios en el reenvío (usa los mismos del original).
- Cableado a otros módulos (desembarque, cierre de ruta, inventario, devoluciones): las
  entidades `EmailLog`/`EmailAttachment` quedan genéricas y listas, pero no se conectan aún.

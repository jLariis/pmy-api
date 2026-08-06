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

- **Backend**: NestJS + TypeORM sobre **MySQL**. Deploy en **Vercel serverless**
  (`@vercel/node`) ⇒ el disco local es efímero, por lo que los adjuntos se guardan en la
  base de datos (LONGBLOB), no en disco ni en un bucket (no hay almacenamiento en la nube
  configurado).
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
   reenvío usa exactamente esos mismos bytes (fidelidad 100%). Almacenamiento: LONGBLOB en MySQL.
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
| `entityId` | varchar | id de la entidad origen (polimórfico, sin FK dura) |
| `to` | text | destinatarios reales usados (ya con filtro dev aplicado) |
| `cc` | text nullable | |
| `subject` | varchar | |
| `status` | enum `SENT \| ERROR` | |
| `error` | text nullable | mensaje completo del error |
| `messageId` | varchar nullable | de la respuesta SMTP |
| `rejected` | text nullable | direcciones rechazadas por el SMTP, si hubo |
| `isResend` | boolean, default false | |
| `triggeredById` | uuid nullable | usuario que disparó el reenvío |
| `attachmentsMeta` | json | `[{ filename, size }]` para mostrar sin cargar bytes |
| `createdAt` | timestamp | hora del envío |

Índice: `(module, entityId, createdAt)` para consultar el historial de una entidad.

### 4.2 `email_attachment` (entidad `EmailAttachment`) — genérica

Los bytes guardados **una sola vez por entidad**. Los reenvíos leen de aquí; no se duplican.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `module` | varchar | |
| `entityId` | varchar | |
| `filename` | varchar | |
| `mimeType` | varchar | |
| `size` | int | |
| `content` | LONGBLOB | bytes del archivo |
| `createdAt` | timestamp | |

Índice: `(module, entityId)`.

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

- `persistAttachments(module, entityId, files): Promise<void>` — guarda los adjuntos una vez.
  Idempotente: si ya existen para esa entidad, no los duplica (reemplaza o no-op).
- `getAttachments(module, entityId): Promise<EmailAttachment[]>`
- `hasAttachments(module, entityId): Promise<boolean>`
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

- `sendByEmail(...)` (primer envío):
  1. `emailLogService.persistAttachments('package_dispatch', dispatchId, [pdf, excel])`.
  2. Intenta enviar; captura resultado o excepción.
  3. `emailLogService.record({...})` con `SENT` o `ERROR` (incluye `to`, `cc`, `subject`,
     `error`, `messageId`, `rejected`, `attachmentsMeta`, `isResend: false`).
  4. Actualiza `emailStatus`/`emailLastSentAt`/`emailLastError` en el despacho.
  5. **No relanza**: devuelve un resultado estructurado (`{ status, error? }`) para que el
     front informe. (Los adjuntos se guardan incluso si el envío falla, para permitir reenvío.)
- `resendEmail(dispatchId, userId)` (nuevo):
  1. Lee adjuntos guardados. Si no hay (despacho histórico), **fallback**: regenera con
     `renderRouteDispatchDocuments`, los persiste, y continúa.
  2. Reenvía a los mismos destinatarios (mismo cálculo + filtro dev).
  3. `record({... isResend: true, triggeredById: userId})`.
  4. Actualiza columnas denormalizadas.
  5. Devuelve `{ status, error? }`.
- `getEmailHistory(dispatchId)` (nuevo): delega en `emailLogService.getHistory`.
- `findAllBySubsidiary`: agrega `pd.emailStatus`, `pd.emailLastSentAt`, `pd.emailLastError` al
  `select` del listado.

### 5.4 `PackageDispatchController` (endpoints nuevos)

- `POST /package-dispatchs/:id/resend-email` → `resendEmail(id, req.user?.userId)`.
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

- **Unit** (`EmailLogService`): `persistAttachments` idempotente; `record` escribe status
  correcto; lógica `SENT` vs `ERROR` cuando `rejected` no está vacío.
- **Integration** (patrón `*.integration.spec.ts` del módulo):
  - Primer envío OK ⇒ `emailStatus = SENT`, se crea `email_log`, se guardan adjuntos.
  - Envío que falla ⇒ `emailStatus = ERROR`, se registra el log, **el request no revienta**.
  - Reenvío ⇒ usa adjuntos guardados, agrega `email_log` con `isResend = true`.
  - Reenvío de despacho sin adjuntos ⇒ **fallback** regenera, persiste y envía.

## 8. Fuera de alcance (YAGNI)

- Cola de envío / reintentos automáticos.
- Confirmación de entrega o de lectura (solo registramos "aceptado por SMTP").
- Edición de destinatarios en el reenvío (usa los mismos del original).
- Cableado a otros módulos (desembarque, cierre de ruta, inventario, devoluciones): las
  entidades `EmailLog`/`EmailAttachment` quedan genéricas y listas, pero no se conectan aún.

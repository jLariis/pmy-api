# Diseño — Pegar FedEx (experimental) · Borrado con aprobación · Archivos de importación

Fecha: 2026-08-21
Autor: Javier (con Claude, rol Dev Senior)
Estado: aprobado en brainstorming, pendiente de revisión del spec

Repos:
- Backend NestJS: `C:\PMY\pmy-api`
- Frontend Next.js: `C:\PMY\app-pmy`

---

## Resumen

Tres funcionalidades independientes:

1. **Pegar datos de FedEx** (copiar/pegar desde Excel) como alternativa a subir archivo, para Aéreo/Master, Pagos (COD), Alto Valor y F2. Botón nuevo **experimental** en Envíos, visible solo a `superadmin` + flag.
2. **Borrado con aprobación del Encargado/Supervisor de sucursal** para **consolidado** y **salida a ruta**, con **baja lógica** (`active=false`), diálogo de impacto con conteos, y una **bandeja de autorización** nueva en la barra superior. Notificación por campana + correo.
3. **Guardar el archivo original + su nombre** de los uploads **FedEx** (master, pagos, alto valor, F2) en una tabla dedicada `import_file`, descargable desde el detalle del consolidado y desde un historial "Importaciones".

Orden de implementación: **Tarea 3 → Tarea 2 → Tarea 1**.

Suposiciones confirmadas por el usuario:
- **A**: el botón de pegar se ve solo con rol `superadmin` **y** flag `NEXT_PUBLIC_EXPERIMENTAL_PASTE`.
- **B**: "Admin Principal" = usuario con rol `superadmin` (fallback cuando la sucursal no tiene supervisor configurado).
- **C**: el flujo de pegar (Tarea 1) **no guarda archivo** por ahora.

---

## Tarea 3 — Archivos de importación FedEx

### Backend

Entidad nueva `ImportFile` (`src/entities/import-file.entity.ts`), tabla `import_file`:

| Campo | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| carrier | varchar | `'FEDEX'` por ahora |
| kind | varchar | `'master' \| 'payment' \| 'high_value' \| 'f2'` |
| originalName | varchar | `file.originalname` |
| storagePath | varchar | ruta relativa a `process.cwd()` |
| mimeType | varchar | |
| size | int | bytes |
| rowCount | int null | filas parseadas (cuando el servicio lo devuelva) |
| subsidiaryId | uuid null | |
| consNumber | varchar null | |
| consolidatedId | uuid null | se liga al consolidado creado/reusado |
| uploadedById | uuid null | |
| uploadedByName | varchar null | |
| createdAt | timestamp | |

- Servicio `ImportFilesService` (`src/import-files/`): `persist(file, meta)` guarda el buffer en disco bajo `uploads/imports/fedex/<consNumber|yyyy-MM-dd>/<uuid>-<originalName>` (patrón `EmailLogService.persistAttachments`), inserta la fila y la devuelve; `findByConsolidated(consolidatedId)`; `list(filtros: subsidiaryId?, kind?, desde?, hasta?)` paginado; `getDownloadable(id)` → `{ stream/buffer, originalName, mimeType }`.
- Controller `ImportFilesController`:
  - `GET /import-files` (historial, filtros) — guard de permiso operativo.
  - `GET /import-files/:id/download` — devuelve el archivo (`StreamableFile`).
  - `GET /import-files/by-consolidated/:consolidatedId`.
- **Wiring**: en `ShipmentsController` los endpoints `upload`, `upload-payment`, `upload-hv`, `upload-charge` llaman a `importFilesService.persist(...)` **después** de un import exitoso, con el `consolidatedId`/`consNumber` que ya resuelve el servicio. Para poder ligar el `consolidatedId`, los métodos de `ShipmentsService` devolverán (o expondrán) el consolidado afectado; si el refactor es invasivo, se persiste primero el archivo (sin `consolidatedId`) y se actualiza el `consolidatedId`/`rowCount` al terminar.
- Migración: `CREATE TABLE import_file` (patrón de migraciones existentes, `DB_SYNC=false` en todos los entornos).

### Frontend
- `lib/services/import-files.ts`: `listImportFiles(params)`, `getImportFilesByConsolidated(id)`, `downloadImportFile(id)`.
- **Detalle del consolidado**: sección "Archivo de origen" con nombre, quién, cuándo, filas, botón Descargar.
- **Historial "Importaciones"**: pantalla nueva (dentro de `AppLayout` + `withAuth` + `OperationHeader`, componentes shadcn) con tabla filtrable (sucursal, tipo, fecha) y descarga.

---

## Tarea 2 — Borrado con aprobación + bandeja

### Modelo de datos (backend)

Entidad nueva `ApprovalRequest` (`src/entities/approval-request.entity.ts`), tabla `approval_request`:

| Campo | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| type | varchar | `'delete_consolidado' \| 'delete_route_dispatch'` |
| targetId | varchar | id del consolidado o del package_dispatch |
| subsidiaryId | uuid null | sucursal del objetivo (para resolver supervisor) |
| requestedById | uuid | quién solicita |
| requestedByName | varchar | |
| approverId | uuid null | supervisor resuelto al crear la solicitud |
| approverName | varchar null | |
| status | varchar | `'pendiente' \| 'aprobado' \| 'rechazado'` |
| reason | varchar null | motivo de rechazo |
| impactSnapshot | jsonb/json | conteos calculados al solicitar |
| createdAt | timestamp | |
| resolvedAt | timestamp null | |

Cambios en entidades existentes:
- `subsidiary`: nueva columna `supervisorUserId uuid null` (FK lógica a `user`), configurable en Configuración.
- `consolidated`: nueva columna `active boolean default true`.
- `package_dispatch`: nueva columna `active boolean default true`.
- `shipment` y `charge_shipment`: nueva columna `active boolean default true` (para ocultar hijos al dar de baja un consolidado, según decisión 2.4).

Migraciones: una por grupo de columnas + tabla `approval_request`.

### Lógica

Módulo nuevo `src/approvals/`:
- `ApprovalsService`:
  - `resolveSupervisor(subsidiaryId)`: `subsidiary.supervisorUserId` → fallback a un usuario `superadmin` (Admin Principal). Devuelve `{id, name}`.
  - `buildImpact(type, targetId)`: calcula conteos.
    - **Consolidado**: # shipments, # cargas (charge_shipment), cuántos de esos van en ruta (`packageDispatch` no nulo / status `EN_RUTA`), cuántos ya generaron ingresos (`income` ligado), # devoluciones.
    - **Salida a ruta**: # shipments, # cargas, si tiene cierre de ruta (`route_closure`), si generó ingresos.
  - `createRequest({type, targetId, requestedBy})`: valida que exista y esté activo, calcula impacto, resuelve supervisor, inserta `pendiente`, emite notificación (campana + email) al supervisor.
  - `approve(id, approver)`: valida que `approver` sea el supervisor asignado (o `superadmin`), ejecuta la **baja lógica** (`active=false` en el objetivo; para consolidado además en sus `shipment`/`charge_shipment`), marca `aprobado`+`resolvedAt`, notifica al solicitante (campana + email).
  - `reject(id, approver, reason)`: marca `rechazado`+motivo, notifica al solicitante.
  - `myPending(user)`: solicitudes `pendiente` donde el user es el supervisor (o `superadmin` ve todas). Alimenta la bandeja.
- Guard: solo el supervisor asignado o `superadmin` puede aprobar/rechazar (mismo criterio que `canApprove` de support: super bypass + autorizador asignado).
- Notificaciones: reutiliza `NotificationsService.emit()`; se agregan tipos al catálogo `notification-catalog.ts`: `'aprobacion.solicitada'`, `'aprobacion.aprobada'`, `'aprobacion.rechazada'` (canales `bell` + `email`).

Controller `ApprovalsController`:
- `POST /approvals` (crear solicitud) `{type, targetId}`.
- `GET /approvals/mine` (bandeja del aprobador, pendientes).
- `POST /approvals/:id/approve`.
- `POST /approvals/:id/reject` `{reason}`.
- `GET /approvals/impact?type=&targetId=` (para el diálogo de impacto antes de solicitar).

Ajustes en servicios existentes:
- `ConsolidatedService`/`PackageDispatchService`: los listados operativos filtran `active=true`. La baja lógica la ejecuta `ApprovalsService` (no los `remove` actuales). Los `@Delete` actuales de `consolidated` y `package_dispatch` se dejan/deprecan; el borrado real pasa por el flujo de aprobación.
- Listados de shipments operativos (consolidados, envíos) filtran `active=true` en shipments/charges. **Riesgo conocido**: superficie de filtrado amplia; se parchean los endpoints de listado operativos principales, no toda consulta.

### Frontend
- `lib/services/approvals.ts`: `getApprovalImpact(type, targetId)`, `requestApproval(type, targetId)`, `getMyApprovals()`, `approveRequest(id)`, `rejectRequest(id, reason)`.
- **Botón "Eliminar"** en consolidados y en salidas a ruta → abre `DeleteRequestDialog` que:
  - llama a `getApprovalImpact`, muestra **quién lo creó**, los **conteos** (shipments, en ruta, con ingresos, cargas, cierre…), y el **nombre del Encargado/Supervisor** al que se pedirá autorización.
  - Confirmar → `requestApproval` → toast "Solicitud enviada a <Encargado>".
- **Bandeja de autorización** en la barra superior (`components/app-layout.tsx`, junto a `<NotificationBell/>`): ícono `Inbox`/`ClipboardCheck` con badge de pendientes, popover que lista solicitudes con impacto y botones **Aprobar / Rechazar (con motivo)**. Visible solo si el usuario es supervisor de alguna sucursal o `superadmin` (hook que consulta `getMyApprovals`).
- **Configuración**: en la pantalla de sucursales, selector "Encargado/Supervisor" (usuario registrado) que setea `subsidiary.supervisorUserId`.
- Todo con shadcn + Tailwind, dentro de `AppLayout`.

---

## Tarea 1 — Pegar datos FedEx (experimental)

### Frontend (sin cambios de backend)
- Componente `PasteImportModal` (`components/import-components/paste-import-modal.tsx`):
  - Selector de **tipo**: Aéreo/Master · Pagos · Alto Valor · F2.
  - `<textarea>` donde el usuario pega desde Excel (TSV: columnas separadas por TAB, filas por `\n`).
  - Parseo en cliente: split por líneas y TAB → matriz. Primera fila = encabezados. Se arma un `.xlsx` en memoria con SheetJS (mismo patrón que `buildWorkbook` de `import-dhl-text-modal.tsx`).
  - Vista previa de las primeras filas parseadas antes de enviar.
  - Envío al endpoint existente según el tipo:
    - Aéreo/Master → `uploadShipmentFile` (`/shipments/upload`) con su preview/validación.
    - Pagos → `uploadShipmentPayments` (`/shipments/upload-payment`).
    - Alto Valor → `uploadHighValueShipments` (`/shipments/upload-hv`).
    - F2 → `uploadF2ChargeShipments` (`/shipments/upload-charge`).
  - Reutiliza la **misma preview/validación + enriquecimiento FedEx** del flujo por archivo (para Master usa `previewShipmentFile` antes de confirmar).
- **Botón nuevo experimental** en `app/operaciones/envios/page.tsx`, rotulado "Pegar (experimental)", visible solo si `user.role === 'superadmin'` **y** `process.env.NEXT_PUBLIC_EXPERIMENTAL_PASTE === '1'`.
- **No** guarda `import_file` (suposición C).

---

## Fuera de alcance (por ahora)
- Guardar archivo/texto de los flujos de **pegar** (Tarea 1).
- Guardar archivos de **DHL**.
- **Revertir** estatus `EN_RUTA` / cierres al dar de baja (la baja es solo lógica).
- Restauración/"des-borrado" desde UI (los datos quedan con `active=false`, recuperables por DB).

## Pruebas
- Backend: unit de `ApprovalsService` (resolver supervisor + fallback, buildImpact conteos, approve ejecuta baja lógica, guard de aprobador), y de `ImportFilesService.persist`. Migraciones aplican en dev (`DB_SYNC=false`).
- Frontend: el diálogo de impacto muestra conteos; la bandeja solo aparece para aprobadores; el botón de pegar solo con superadmin+flag.

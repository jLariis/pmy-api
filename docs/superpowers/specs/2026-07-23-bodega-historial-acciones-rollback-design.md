# Bodega: auto-descarga + acciones de historial + rollback — Diseño

Fecha: 2026-07-23
Repos: `pmy-api` (backend), `app-pmy` (frontend)

## Contexto

El módulo de bodega ya unifica la generación de PDF/Excel en el backend (mismos
archivos que el correo) vía `GET /warehouse/outbound/:id/{pdf,excel}`. Falta:

1. Que el usuario NO descargue manualmente: al confirmar una salida, los archivos
   se descargan solos.
2. En el historial (entradas y salidas): botones para ver detalles, regenerar
   Excel y regenerar PDF.
3. Para superadmin: un botón de **rollback** que revierte la operación.

## Alcance

- Auto-descarga tras "Confirmar y Guardar" en el modal de Salida de Bodega.
- Endpoints de archivos para ENTRADAS (equivalentes a los de salidas).
- Historial (entradas y salidas): columna "Acciones" con Ver detalles / Regenerar
  Excel / Regenerar PDF / Rollback (superadmin).
- Rollback transaccional, auditado, con regla de seguridad.

Fuera de alcance: cambiar la generación de archivos (ya está), tocar el flujo de
importación FedEx/DHL (duplicación de shipments es otro tema, ya verificado que el
traspaso no la causa).

## 1. Auto-descarga (frontend)

En `outbound-package.tsx`, `handleConfirm` (éxito):
- Guarda, obtiene `outboundId`.
- Dispara `downloadOutboundFile(id, 'pdf')` y `downloadOutboundFile(id, 'excel')`
  automáticamente.
- Resetea la sesión y cierra el modal.
- Se retiran los botones manuales PDF/Excel y el estado "saved" del modal (ya no
  se necesitan; el historial permite re-descargar). `SignatureDialog` vuelve a su
  forma previa para salidas (sin `pdfButton`/`saved`), conservando el flujo de
  Entrada a Bodega intacto.

## 2. Endpoints de archivos para ENTRADAS (backend)

`WarehouseService`:
- `resolveInboundForFiles(receivingId)` → `{ header, packages, label, subsidiaryName }`
  a partir del `WarehouseReceiving` (título `ENTRADA A BODEGA`, sucursal =
  `warehouseId`, hidrata paquetes del snapshot `shipments`).
- `getInboundPdf(id)` / `getInboundExcel(id)` (mismo patrón que outbound).

`WarehouseController`:
- `GET /warehouse/inbound/:id/pdf`
- `GET /warehouse/inbound/:id/excel`

## 3. Detalles de la operación (backend + frontend)

Endpoint de detalles hidratados (más útil que el snapshot pobre del historial):
- `GET /warehouse/outbound/:id/details` y `GET /warehouse/inbound/:id/details`
- Devuelve metadata de la operación (fecha, tipo, sucursal, destino/rutas,
  vehículo, choferes, folio, totales, `rolledBack`) + paquetes hidratados
  (guía, destinatario, dirección, CP, teléfono, cobro, `commitDateTime`, estatus,
  isCharge, isHighValue).

Frontend: modal `OperationDetailsDialog` que consume ese endpoint (tabla de
paquetes + cabecera de la operación).

## 4. Historial: columna Acciones (frontend)

En `warehouse-history-dialog.tsx`, nueva columna con botones por fila:
- **Ver detalles** → `OperationDetailsDialog`.
- **Regenerar Excel** → endpoint excel (inbound/outbound según `kind`).
- **Regenerar PDF** → endpoint pdf.
- **Rollback** (solo superadmin, `hasPermission(user, 'warehouse.rollback')` o
  `SUPER_ROLES`) → confirmación + `POST …/rollback`; al éxito refresca la lista.

Filas ya revertidas (`rolledBack`) se muestran atenuadas con badge "Revertido" y
sin acciones de rollback/regenerar.

## 5. Rollback (backend)

`POST /warehouse/outbound/:id/rollback` y `POST /warehouse/inbound/:id/rollback`,
transaccional, **guardado en backend a superadmin** (guard de rol/permiso) además
del gate en UI.

### Reconstrucción del estatus previo (desde historial)
Por cada paquete (Shipment/ChargeShipment) del snapshot de la operación:
1. Leer sus `ShipmentStatus` ordenados por `timestamp` desc.
2. **Regla de seguridad**: solo revertir si el estatus ACTUAL del paquete sigue
   siendo el que puso la operación (y, en traspaso, si `subsidiaryId` sigue siendo
   la sucursal destino). Si ya avanzó, **omitir y reportar** — nunca pisar cambios
   posteriores.
3. Tomar el penúltimo `ShipmentStatus` como estatus previo → restaurar
   `shipment.status`.
4. Borrar el/los `ShipmentStatus` que creó la operación (los más recientes con el
   estatus objetivo y timestamp ~ fecha de la operación).

### Por tipo
- **Traspaso**: restaurar `subsidiaryId` → `warehouseId` (origen) + estatus previo.
- **Despacho**: estatus previo + eliminar `PackageDispatch` (pivotes shipments/
  chargeShipments + `PackageDispatchHistory` + registro).
- **Entrada**: estatus previo (revierte `EN_BODEGA`) + eliminar remesas creadas por
  esa recepción (`ShipmentRemittance` con `warehouseReceivingId = id`).

### Auditoría (no se borra el registro)
Marcar el `WarehouseOutbound`/`WarehouseReceiving`:
- `rolledBack: boolean` (default false)
- `rolledBackById: string | null` (usuario)
- `rolledBackAt: datetime | null`

El historial activo filtra `rolledBack = false` (o los muestra atenuados; ver §4).

### Respuesta
`{ reverted: number, skipped: { trackingNumber, reason }[] }`

### Migración
`ALTER TABLE warehouse_outbound` y `warehouse_receiving`: agregar
`rolledBack tinyint default 0`, `rolledBackById varchar(36) null`,
`rolledBackAt datetime null`.

## Aproximación técnica

- Reutilizar el patrón `resolve…ForFiles` (extraer base común para archivos +
  detalles).
- Rollback: un método de servicio por tipo, dentro de una transacción con
  `queryRunner`, devolviendo `{ reverted, skipped }`.
- Guard de superadmin en backend: nuevo `SuperAdminGuard` (roles `superadmin`/
  `superamin`, consistente con `SUPER_ROLES` del frontend), aplicado a los
  endpoints de rollback con `@UseGuards`. El `AdminGuard` existente es demasiado
  amplio (admite admin/subadmin/owner), por eso no se reutiliza.
- Filtrado del historial activo: `findInbound/OutboundBySubsidiary` excluyen
  `rolledBack = true` (o lo exponen para atenuar; decisión de UI en §4 → se expone
  el flag y la UI atenúa, para que el superadmin vea qué se revirtió).

## Pruebas

- Backend (unit/mappers, sin DB donde se pueda): 
  - `resolveInboundForFiles` arma header/paquetes correctos.
  - Rollback: lógica de "reconstruir previo desde historial" y regla de seguridad
    (paquete que avanzó → omitido) con `queryRunner` simulado (patrón del test
    `warehouse-transfer-no-duplicate.spec.ts`).
- Frontend: typecheck; verificación manual del flujo (levantar stack).

## Riesgos / decisiones

- Rollback es destructivo: la regla de seguridad (omitir paquetes que avanzaron)
  es obligatoria. Aprobada por el usuario.
- Identificar los `ShipmentStatus` creados por la operación es heurístico
  (estatus objetivo + timestamp ~ operación). Mitigación: además de timestamp,
  acotar al estatus objetivo y al paquete; si hay ambigüedad, borrar solo el más
  reciente con ese estatus.
- Guard de superadmin DEBE estar en backend (no confiar solo en UI).

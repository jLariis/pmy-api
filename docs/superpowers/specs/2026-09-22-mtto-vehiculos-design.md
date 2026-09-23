# Mantenimiento de Vehículos — Diseño

Fecha: 2026-09-22 · Rama: `feat/mtto-vehiculos` (pmy-api + app-pmy)

## Objetivo

Gestionar el mantenimiento de la flota (vehículos ya dados de alta): catálogo de servicios con precios de referencia, proveedores con contactos, solicitudes de mantenimiento con varias cotizaciones comparables, conversión de la cotización ganadora en orden de compra, autorización exclusiva (Edgardo Lugo + superadmin), PDF institucional, envío al proveedor por su canal predeterminado (correo o WhatsApp), cierre con historial y gasto. Además se terminan las páginas existentes **Programación** e **Historial** del menú "Mtto. Vehículos", y el kilometraje del vehículo pasa a actualizarse con las rutas.

## Flujo

```
Solicitud (vehículo + necesidad + km)
  └─ N Cotizaciones (1 por proveedor, partidas + adjunto opcional)
       └─ Bandeja: comparar → elegir ganadora → "Convertir en orden"
            └─ Orden de compra (borrador) → Enviar a autorización
                 └─ Autorizador: aprueba partidas / edita → Autoriza | Rechaza(motivo → borrador)
                      └─ Enviar (PDF solo partidas aprobadas) por canal predeterminado
                           └─ Completar (km, fecha, monto final, próximo mtto opcional)
                                → actualiza vehículo, cierra solicitud, crea Gasto
```

## Modelo de datos (migración 074, esquema SOLO por migración — DB_SYNC=false)

Todas las tablas con `createdAt`, `updatedAt`, `createdById` y baja lógica `deletedAt` donde se indica.

- **`maintenance_service_category`**: `id`, `name` (único), `sortOrder`, `active`. Semilla: Afinación y motor, Frenos, Suspensión y dirección, Llantas, Transmisión y clutch, Eléctrico y batería, Aire acondicionado, Carrocería y pintura, Refacciones, Lavado y limpieza, Verificación y trámites, Otros.
- **`maintenance_service`**: `id`, `name`, `categoryId`, `unit` (servicio/pieza/litro/juego), `referencePrice` decimal(12,2), `vehicleType` (enum VehicleTypeEnum, nullable = aplica a todos), `active`, `deletedAt`.
- **`supplier`**: `id`, `name` (razón social), `rfc`, `address`, `notes`, `active`, `deletedAt`.
- **`supplier_contact`**: `id`, `supplierId`, `name`, `position`, `email`, `phone`, `whatsapp`, `preferredChannel` enum(`email`,`whatsapp`), `isDefault` (uno por proveedor).
- **`maintenance_request`**: `id`, `folio` (`SM-000001`), `vehicleId`, `subsidiaryId` (heredada del vehículo), `kmsAtRequest`, `description`, `priority` enum(`baja`,`media`,`alta`), `status` enum(`abierta`,`en_cotizacion`,`orden_generada`,`completada`,`cancelada`), `deletedAt`.
- **`maintenance_quote`**: `id`, `requestId`, `supplierId`, `quoteDate`, `validUntil`, `notes`, `attachmentPath`/`attachmentName`/`attachmentMime` (archivo en disco, patrón EmailAttachment), `subtotal`, `tax`, `total`, `status` enum(`capturada`,`ganadora`,`descartada`), `deletedAt`.
- **`maintenance_quote_item`**: `id`, `quoteId`, `serviceId` (nullable → partida libre), `description`, `quantity`, `unitPrice`, `taxRate` (default 0.16), `amount`, `referencePrice` (snapshot), `deviationPct`.
- **`purchase_order`**: `id`, `folio` (`OC-000001`), `requestId`, `quoteId`, `supplierId`, `contactId`, `vehicleId`, `subsidiaryId`, `status` enum(`borrador`,`pendiente`,`autorizada`,`rechazada`,`enviada`,`completada`,`cancelada`), `notes`, `rejectionReason`, `authorizedById`, `authorizedAt`, `subtotal`/`tax`/`total` (de partidas aprobadas), `completedAt`, `completedKms`, `finalAmount`, `expenseId`, `cancelReason`, `deletedAt`.
- **`purchase_order_item`**: copia de la partida de cotización (`serviceId`, `description`, `quantity`, `unitPrice`, `taxRate`, `amount`) + `approved` bool (default true).
- **`purchase_order_dispatch`**: `id`, `purchaseOrderId`, `channel`, `destination`, `status` (`enviado`,`error`), `error`, `emailLogId` (nullable), `sentById`, `sentAt`. Una fila por intento.
- **`maintenance_folio_counter`**: `prefix` (PK: `SM`, `OC`), `lastValue` int. Folio generado dentro de la transacción con `SELECT … FOR UPDATE` + incremento (no existe contador genérico en el repo; soporte usa conteo).
- **`vehicle`** (columnas nuevas): `lastMaintenanceKms` int null, `maintenanceIntervalKms` int default 5000.
- **`company_settings`** (columna nueva): `maintenanceDeviationPct` decimal default 15.

Backfill en la migración: `vehicle.kms = GREATEST(vehicle.kms, max numérico de package_dispatch.kms y route_closure.actualKms del vehículo)`.

## Kilometraje vivo

Helper puro `nextVehicleKms(current, captured)`: devuelve el nuevo km solo si `captured` es numérico, `> current` y el salto es `≤ 5000` km; en otro caso conserva `current` (y se registra warning). Se invoca al crear salida a ruta (`package-dispatch.service` create, `dto.kms`) y al cerrar ruta (`routeclosure.service`, `actualKms`). Nunca hace fallar la operación principal.

## Programación (semáforo)

Helper puro `maintenanceStatus(vehicle, today)` (espejado en FE `lib/maintenance-status.ts` ↔ BE `maintenance-status.util.ts`, mantener en sync):

- `nextKms = lastMaintenanceKms + maintenanceIntervalKms` (si hay `lastMaintenanceKms`).
- **Vencido**: `kms ≥ nextKms` o `nextMaintenanceDate < today`.
- **Próximo**: `nextKms - kms ≤ 1000` o `nextMaintenanceDate` en ≤ 15 días.
- **Sin datos**: ni `lastMaintenanceKms` ni `nextMaintenanceDate`.
- **Al día**: resto. Gana el más severo.

## Máquina de estados de la orden

Función pura `assertTransition(from, to)`:

| De | A | Quién |
|---|---|---|
| borrador | pendiente | manage |
| borrador, rechazada | (eliminar, baja lógica) | manage |
| pendiente | autorizada / rechazada | autorizador |
| rechazada | borrador | automático al rechazar (guarda motivo) |
| autorizada | enviada | manage / autorizador |
| enviada | enviada (reenvío) | manage / autorizador |
| enviada | completada | manage |
| autorizada, enviada | cancelada (con motivo; si enviada, aviso al proveedor por el mismo canal) | manage / autorizador |

- Editar partidas: `manage` solo en borrador; autorizador en pendiente o autorizada. Si alguien sin permiso de autorizar modifica una autorizada → vuelve a pendiente (en la práctica solo el autorizador puede editarla).
- Autorizar exige ≥ 1 partida `approved`.
- Totales de la orden = solo partidas aprobadas.

Cotizaciones: editables/eliminables mientras la solicitud no tenga orden. Convertir ganadora → crea orden borrador con copia de partidas y contacto predeterminado; ganadora = `ganadora`, resto = `descartada`; solicitud → `orden_generada`. Agregar la primera cotización pasa la solicitud a `en_cotizacion`.

## Permisos (RBAC)

Catálogo `permission-catalog.ts` + migración Sync idempotente:

- Existentes: `mttoVehiculos.programacion`, `mttoVehiculos.historial`.
- Nuevos: `mttoVehiculos.solicitudes`, `mttoVehiculos.ordenes`, `mttoVehiculos.catalogos` (admin, superadmin).
- `mttoVehiculos.autorizar`: sin roles; la migración busca al usuario de Edgardo Lugo por email (`edgardolugo@paqueteriaymensajeriadelyaqui.com`, fallback por nombre) e inserta en `user_permission`. Si no lo encuentra, registra warning (se asigna luego desde Roles y Permisos). Superadmin también autoriza (bypass habitual).

Alcance por sucursal: todas las listas filtran por la sucursal elegida en el Selector de Sucursales (el componente ya respeta rol y sucursales asignadas); el backend valida que la sucursal pedida esté permitida para el usuario.

## Backend (módulo `src/maintenance`)

Submódulos/servicios: `categories`, `services` (catálogo), `suppliers` (+contacts), `requests`, `quotes`, `purchase-orders`, `po-dispatch` (PDF + envío), `schedule` (programación/historial). Endpoints REST bajo `/maintenance/*` protegidos por permiso. Auditoría (`audit`) en crear/autorizar/rechazar/enviar/completar/cancelar. Notificación (campana) al autorizador cuando una orden pasa a pendiente; contador de pendientes para la barra.

Completar orden: transacción que actualiza `vehicle.lastMaintenanceDate`, `lastMaintenanceKms`, `kms` (vía `nextVehicleKms`), `nextMaintenanceDate` opcional; `request.status = completada`; crea `Expense` en la sucursal con categoría de gastos "Mantenimiento vehicular" (se crea si no existe), monto `finalAmount`, referencia a la OC; guarda `expenseId`.

## PDF

Plantilla `purchase-order` en `documents` (seed en `pdf-templates.seed.ts`, editable en el editor de plantillas). Datos: branding/company_settings (logo, razón social, RFC, dirección, contacto), folio, fecha, sucursal, proveedor y contacto, unidad (código/nombre, placas, marca, modelo, km), tabla SOLO partidas aprobadas, subtotal/IVA/total, total en letra, notas/condiciones, "Autorizó: <nombre> — <fecha>". Generado al vuelo con `html-to-pdf`; solo la copia enviada se guarda como adjunto de EmailLog.

## Envío

- Correo: `mail.service` con PDF adjunto, registrado en EmailLog.
- WhatsApp: nuevo `WhatsappGatewayService.sendDocument(to, buffer, fileName, caption)`; número normalizado a MX (`52` + 10 dígitos).
- Canal por defecto = `preferredChannel` del contacto; se puede cambiar al enviar. Falla → orden sigue `autorizada`, se registra `purchase_order_dispatch` con error y la UI ofrece el otro canal. Reenvío permitido.

## Frontend (app-pmy, menú "Mtto. Vehículos")

Todas las pantallas: AppLayout + withAuth + OperationHeader + Selector de Sucursales, solo shadcn + Tailwind, DataTable, textos en lenguaje simple.

- **Programación** `/programacion-mtto` (terminar): tarjetas resumen por semáforo; tabla de vehículos (código, placas, km, último mtto fecha/km, intervalo, próximo km/fecha, semáforo); acciones "Programar" (intervalo, último km/fecha, próxima fecha) y "Nueva solicitud".
- **Solicitudes** `/mtto/solicitudes` + detalle: cotizaciones, "Agregar cotización" (partidas del catálogo con precio sugerido y aviso ámbar de desviación > umbral, o libres; adjunto), comparativo lado a lado.
- **Bandeja de cotizaciones** `/mtto/cotizaciones`: solicitudes con cotizaciones por decidir → elegir ganadora → convertir.
- **Órdenes de compra** `/mtto/ordenes` + detalle: pestañas por estado; editar, enviar a autorización, ver PDF, enviar/reenviar (canal), completar, cancelar, eliminar. Autorizador: checks de partidas, edición, Autorizar/Rechazar; contador en la barra.
- **Historial** `/historial-mtto` (terminar): órdenes completadas por vehículo (fecha, km, proveedor, servicios, monto), totales por vehículo y periodo; incluye vehículos con `lastMaintenanceDate` previo.
- **Catálogos** `/mtto/catalogos`: pestañas Servicios / Categorías / Proveedores (contactos, predeterminado).

Sidebar (`lib/constants.ts`) y `allowed-page-roles.ts` con los nuevos ítems/códigos; `support/module-directory.ts` actualizado.

## Pruebas

- Jest (pmy-api): `assertTransition`, `maintenanceStatus`, `nextVehicleKms`, totales/IVA solo aprobadas, `deviationPct`, mapper del PDF (solo aprobadas), guard de autorizador (usuario con permiso y superadmin sí, admin no), normalización de WhatsApp.
- Vitest (app-pmy): `maintenanceStatus`.

## Fases

1. **F1**: migración 074 + permisos, catálogos (categorías/servicios/proveedores), km vivo, Programación.
2. **F2**: solicitudes, cotizaciones, comparativo, bandeja.
3. **F3**: órdenes, autorización, PDF, envío correo/WhatsApp.
4. **F4**: completar → vehículo + gasto, Historial.

## Fuera de alcance

Inventario de refacciones, facturas/pagos a proveedor, recordatorios automáticos por correo, portal del proveedor.

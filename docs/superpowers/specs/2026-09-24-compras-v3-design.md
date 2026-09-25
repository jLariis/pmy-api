# Compras (v3) — Diseño

Fecha: 2026-09-24 · Rama: `feat/mtto-vehiculos` (pmy-api + app-pmy) · Reemplaza el alcance de `2026-09-22-mtto-vehiculos-design.md` (v1/v2): lo que ya existe (expediente con pasos, autorización por partida, PDF, envío, cierre→gasto, km vivo) se reutiliza y se amplía.

## Objetivo

Módulo **Compras**: cualquier usuario levanta una **solicitud** (mantenimiento, servicio, reparación o compra de equipo/material); **Gerardo Robles** (o superadmin) la revisa y autoriza, cotiza con varios proveedores **por partida**, genera **una orden por proveedor ganador**; **Edgardo Lugo** (o superadmin) autoriza cada orden; se envía al proveedor con PDF por correo/WhatsApp; al cerrar se registra el gasto. Catálogos de piezas, insumos, presentaciones, productos con precios por proveedor (calidad en estrellas) y ficha de piezas/insumos por unidad.

## Flujo y estados

```
Solicitud (cualquiera) ──► Por revisar ──(Gerardo autoriza)──► Cotizando ──(genera órdenes)──► Órdenes (1 por proveedor)
                              └─(Gerardo rechaza, motivo)──► Rechazada          │
                                                                               ▼
                                              cada orden: Por autorizar (Edgardo) → Autorizada → Enviada → Completada
Solicitud Terminada cuando TODAS sus órdenes están completadas o canceladas (≥1 completada).
```

- `maintenance_request.status`: `por_revisar` (nuevo, inicial) · `rechazada` (nuevo) · `abierta`/`en_cotizacion` (= Cotizando) · `orden_generada` · `completada` · `cancelada`.
- Etapa del tablero (función pura `expedienteStage`, ahora con N órdenes): `por_revisar` → `cotizando` → `por_autorizar` (alguna orden pendiente) → `en_taller`/`en_proceso` (órdenes autorizadas/enviadas) → `terminado`; `rechazada`/`cancelado` aparte. "Siguiente paso" y "quién lo tiene" (`solicitante`, `compras` = Gerardo, `autorizador` = Edgardo, `proveedor`).

## Tipos de solicitud

`mantenimiento | servicio | reparacion | compra`. Los tres primeros **requieren unidad**; `compra` la tiene opcional. El gasto al cerrar cae en la categoría de gastos por tipo: mantenimiento/servicio/reparación → "Mantenimiento"; compra → "Compras" (se crea si no existe). El tablero filtra por tipo.

## Modelo de datos (migración 078, sin COLLATE explícito)

Nuevas:
- **`unit_of_measure`**: `id`, `name` (único), `abbreviation`, `active`. Semilla: Pieza (PZA), Litro (L), Medio litro, ¼ litro, Galón, Cubeta, Garrafa, Juego, Servicio.
- **`product_category`**: `id`, `name`, `kind` enum(`pieza`,`insumo`,`servicio`,`equipo`), `active`, único (`kind`,`name`). Semilla desde el Excel: 87 piezas + 16 insumos (limpieza de espacios/mayúsculas, se conserva el texto); se migran las 12 categorías viejas de servicio como `kind=servicio`.
- **`product`**: `id`, `name`, `description`, `categoryId`, `brand`, `partNumber`, `unitId`, `active`, `deletedAt`. Los `maintenance_service` existentes se migran como productos de categoría `servicio`.
- **`product_offer`**: `id`, `productId`, `supplierId`, `unitId`, `price` decimal(12,2), `quality` tinyint 1–5 (null = sin calificar), `lastQuotedAt`, único (`productId`,`supplierId`,`unitId`). Se actualiza (upsert) al guardar una cotización con partidas de catálogo. Semilla: productos de la Hoja 1 del Excel con sus proveedores/precios/estrellas.
- **`request_item`**: `id`, `requestId`, `productId` null, `categoryId` null, `description`, `quantity`, `unitId` null, `notes`, `selectedQuoteItemId` null (ganador elegido en el comparativo), `sortOrder`.
- **`vehicle_spec_item`** (ficha): `id`, `vehicleId`, `categoryId` (pieza o insumo), `productId` null (preferido), `quantity`, `unitId` null, `notes`.

Cambios:
- **`maintenance_request`**: + `type` enum (default `mantenimiento`), `vehicleId` NULL, + `reviewedById`, `reviewedAt`, `rejectionReason`; enum de `status` + `por_revisar`,`rechazada`; folio `SOL-000001` (contador `SOL`, se renombran los MT- existentes).
- **`maintenance_quote_item`**: + `requestItemId` null, `productId` null (reemplaza `serviceId`; se copia), `availability` enum(`si`,`no`,`sobre_pedido`) default `si`, `leadTimeDays` null, `ivaEnabled` bool default 1, `iepsEnabled` bool default 0, `iepsRate` decimal(6,4) default 0, `quality` tinyint null.
- **`purchase_order`**: puede haber **varias por solicitud** (se quita la regla de una); + `ieps` decimal. **`purchase_order_item`**: + `requestItemId`, `productId`, `ivaEnabled`, `iepsEnabled`, `iepsRate`.
- **`supplier`**: + `bankName`, `clabe` (18 dígitos, validada con dígito verificador), `accountNumber`.

## Impuestos

Por partida: switch **IVA** (16%) y switch **IEPS** + tasa (8%, 26.5%, 30%, 53%, u otra). IEPS se calcula sobre el importe; IVA sobre importe + IEPS. Totales: subtotal, IEPS, IVA, total. Switches generales en la cabecera aplican a todas las partidas. Util puro `lineTaxes`/`totals` (BE) espejado en FE.

## Comparativo por partida

Matriz renglones de la solicitud × proveedores (cotizaciones). Cada celda: precio unitario, importe, existencia, estrellas. Se marca el **mejor precio por renglón** (entre los que tienen existencia; si ninguno, el más barato). Gerardo elige ganador por renglón (propuesta automática = mejor precio con existencia). **PDF del comparativo**. **Generar órdenes**: agrupa renglones por proveedor ganador → una OC por proveedor (partidas copiadas de la cotización ganadora), todas a *Por autorizar* y notificadas a Edgardo.

## Pedir cotización

Desde la solicitud (etapa Cotizando): elegir proveedores y contacto → PDF "Solicitud de cotización" (renglones, cantidades, unidad, notas; sin precios) enviado por correo/WhatsApp (reutiliza PoDispatch/EmailLog); queda en la actividad.

## Permisos

- Crear y ver **sus** solicitudes: **cualquier usuario autenticado** (sin permiso RBAC).
- `mttoVehiculos.revisar` (nuevo, sin roles): **Gerardo Robles** por `user_permission` (mig 079) + superadmin: ve todas, autoriza/rechaza solicitudes, cotiza, genera órdenes.
- `mttoVehiculos.autorizar`: Edgardo + superadmin (sin cambio).
- Catálogos: `mttoVehiculos.catalogos` (admin, superadmin, Gerardo).

## Avisos al solicitante

Campana + correo (y WhatsApp si tiene teléfono): autorizada para cotizar, rechazada (motivo), orden(es) autorizada(s)/comprada, entregada/terminada. Gerardo recibe aviso de cada solicitud nueva.

## Pantallas (menú **Compras**)

- **Solicitudes**: las mías (Kanban/lista) + "Nueva solicitud" en el header (tipo, sucursal con selector — default la del usuario —, unidad, renglones con buscador de catálogo, sugerencias de la ficha, prioridad, descripción).
- **Tablero de compras** (Gerardo/superadmin): todas las sucursales, columnas Por revisar · Cotizando · Por autorizar · En proceso · Terminado; filtros por tipo/sucursal.
- **Expediente** (`/compras/solicitud?id=`): stepper Solicitud → Revisión → Cotizaciones → Órdenes → Cierre; acciones del paso en el header (regla OperationHeader); secciones: renglones, cotizaciones, comparativo por partida, órdenes (una tarjeta por orden con su PDF/envío/estado), actividad.
- **Unidades**: programación + **ficha de piezas e insumos** por unidad.
- **Historial**.
- **Catálogos**: Productos (con precios por proveedor y estrellas) · Piezas · Insumos · Presentaciones · Proveedores (banco/CLABE).

Reglas de la casa: shadcn + Tailwind, OperationHeader como barra de tareas, validación campo por campo con mensajes en llano, errores del servidor traducidos.

## Fases

1. **F1 Catálogos**: migración 078 (catálogos + proveedor banco/CLABE) + carga del Excel; API y pantallas de Productos/precios/estrellas, Piezas, Insumos, Presentaciones; proveedor con banco/CLABE.
2. **F2 Solicitudes**: tipo, renglones, sucursal, unidad opcional, ficha de unidad + sugerencias; permiso `revisar` (mig 079) + tablero de Gerardo; autorizar/rechazar; avisos.
3. **F3 Cotización**: partidas por renglón con existencia/IVA/IEPS; pedir cotización (PDF+envío); comparativo por partida + PDF; generar N órdenes.
4. **F4 Órdenes y cierre**: impuestos en PDF de OC, órdenes visibles en el expediente, gasto por tipo, historial.

## Fuera de alcance

Inventario/almacén, facturas y pagos a proveedores, recepción parcial por partida.

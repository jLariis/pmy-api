# Cambiar tipo de consolidado (paquete ↔ carga)

2026-10-07 · rama `feat/consolidado-cambiar-tipo` (pmy-api y app-pmy) · parte de "Acciones sobre consolidado"
(`2026-10-06-consolidado-acciones-design.md`).

## Problema

Un consolidado se sube con el tipo equivocado (la F2 como master, o al revés), o dentro de un master
vienen guías que eran de la F2 (Cabo 305820438524: 21 guías cobradas dos veces). Hoy se corrige a
mano o con scripts. Se quiere una acción con justificación y autorización que haga todo el cambio:
registros, consolidado, carga, cobros COD e ingresos.

## Decisiones (aprobadas)

- **Alcance:** consolidado completo **o** guías elegidas.
- **Tipo del consolidado:** `consolidated.type` NO se toca: no distingue la F2 (la subida F2 crea `ordinario`); el tipo real es si la fila trae paquetes o cargas.
- **Registros:** nunca se borra ni se clona historial. El original queda `active=0` con su historial;
  nace el registro en la otra tabla con los mismos datos y su **estatus actual**, más UNA línea de
  historial "Cambio de tipo …" fechada al último evento del original.
- **En ruta:** se permite con aviso. Si el original tiene `routeId`, el nuevo lo hereda y se agrega
  su fila en `package_dispatch_history` de esa salida (el cierre lo encuentra). Salidas pasadas no
  se tocan.
- **Autorización:** igual que borrar/cambiar sucursal (`approval_request`, justificación ≥10, una
  pendiente por familia, supervisor de la sucursal, nadie autoriza lo propio salvo superadmin).

## Reglas del cambio

Tipo nuevo `type: 'change_type_consolidado'`, payload:

```ts
{ toType: 'carga' | 'paquete'; trackingNumbers?: string[]; targetConsolidatedId?: string; isHalfTon?: boolean }
```

### A paquete → carga

1. Cada guía elegida (todas si no hay lista): `shipment.active=0`; nuevo `charge_shipment` con los
   mismos datos, `status`/`exceptionCode` actuales, `routeId`, `consolidatedId`/`consNumber`/`chargeId`
   del destino.
2. Ingresos por paquete activos de esas guías → anulados.
3. COD: `payment.chargeShipmentId = nuevo`, `payment.shipmentId = NULL` (se mueve, no se copia).
4. **Destino de la carga:**
   - `targetConsolidatedId` (otra F2 ya subida) → su carga activa; NO se crea ingreso (ya cobró).
   - si no, la carga activa de la misma familia si existe (sin ingreso nuevo);
   - si no, se crea `charge` (consNumber, sucursal, `chargeDate` = día del consolidado, `isHalfTon`)
     con su ingreso de carga: tarifa de la sucursal, domingo/festivo, segundo a bordo y "solo la 1ª
     carga del día" (mismas funciones que la subida F2).
5. Consolidado completo: las guías se quedan en la misma fila de consolidado.

### B carga → paquete

1. Cada guía elegida: `charge_shipment.active=0`; nuevo `shipment` con sus datos y estatus actual,
   ligado al consolidado destino (`targetConsolidatedId`, o el master de la misma familia; si no hay
   y es por guías se crea un consolidado `ordinario` con el mismo número).
2. COD: `payment.shipmentId = nuevo`, `shipment.paymentId = payment.id`, `payment.chargeShipmentId = NULL`.
3. Ingreso por paquete: si el estatus actual es cobrable (entregado / rechazado / devuelto / cliente no
   disponible — `deriveRepairIncome`) se crea, fechado al último evento, costo por paquete de la
   sucursal (FedEx/DHL). Los que siguen en tránsito cobran normal en su cierre.
4. Consolidado completo: la carga y su ingreso se anulan (`active=0`) (el consolidado se queda igual).
   `ordinario`. Por guías la carga sigue (cobró por el resto).

### Avisos (no bloquean)

En ruta ahora · salió a ruta antes · guía ya existe activa en la tabla destino del mismo consolidado
(se omite) · sucursal sin tarifa por paquete · carga del día sin cobro por "solo la 1ª".

## Diseño técnico

- `consolidated-type.plan.ts` (puro): recibe la familia extendida (guías con datos completos, último
  evento, pago, ruta) + tarifa + destino y devuelve `ActionPlan` con `changes` (UPDATE, lista blanca
  ampliada: `shipmentId`, `chargeShipmentId`, `paymentId`) **e `inserts`**
  (filas nuevas con id ya generado: `shipment`, `charge_shipment`, `charge`, `income`,
  `shipment_status`, `package_dispatch_history`).
- `ConsolidatedActionsExecutor.apply` aplica `inserts` (lista blanca de tablas) antes de los UPDATE;
  cada fila nueva queda en `consolidated_change_log` (`field='__created'`) y los ingresos nuevos en
  `income_change_log` (`action='create'`).
- `ConsolidatedFamilyLoader.loadTypeDetails` trae lo extra solo para esta acción.
- `ConsolidatedActionsService` agrega validación (`toType` válido, guías dentro de la familia,
  destino activo de la misma sucursal y tipo correcto) y el plan.
- Front: "Cambiar tipo" en "Más acciones" del consolidado (diálogo con tipo, guías, 1.5 ton,
  justificación e impacto). En el detalle del correo, aviso de tipo distinto con botón que abre el
  mismo diálogo ya lleno (permiso `correo.subir`). Para eso `system-match` guarda `consolidatedId`
  por grupo.

## Pruebas

Plan puro: completo A y B, por guías A con destino existente / misma familia / carga nueva, B con
estatus cobrable y en tránsito, COD, en ruta, guía ya existente en destino. Ensayo con reversa en BD
local con el caso real de Cabo (305820438524 → F2 del mismo correo).

# Parte B — Candados de subida y estatus finales

Fecha: 2026-10-06 · Rama `feat/consolidado-acciones` (pmy-api + app-pmy) · Origen: análisis "DIF CABOS SEM 28SEP-03OCT".

## Decisiones del usuario

1. Guía F2 no entra también como paquete normal (se omite, se informa).
2. Mismo consolidado activo en OTRA sucursal → **bloquear siempre** la subida (sin forzar).
3. **ENTREGADO y DEVUELTO_A_FEDEX son finales**: ningún proceso automático vuelve a tocar el registro (ni estatus, ni historial, ni ingresos). "Ahí termina su vida." Las correcciones MANUALES (Consolidador, herramientas superadmin) sí pueden.
4. Una "entrega" de FedEx seguida de más movimiento (salió, llegó, va en camino, OD, PU) **no es entrega**: no se toma como estatus ni cobra.
5. Una devuelta solo "vuelve" si llega en un consolidado NUEVO → es un registro nuevo; el viejo queda devuelto.
6. Entrega registrada por FedEx días después de la ruta: el ingreso va con la fecha de FedEx (sin cambio de código; fue operativo).

## Caminos cubiertos

- Master: `ShipmentsService.addConsMasterBySubsidiary` (Excel/pegado directo) y `ImportJobsService` (cola de pegado; `create`, `preview`, worker master).
- F2: `ShipmentsService.processFileF2` y `addChargeShipments` (directo y por cola).
- Vista previa: `ShipmentsService.previewUpload` e `ImportJobsService.preview`.
- La Bandeja de correos usa esos mismos endpoints.

## Candado 1 — F2 no entra como paquete

Al insertar el master (ambos caminos), se omiten las guías que ya existen como `charge_shipment` ACTIVO del mismo consNumber normalizado y la misma sucursal. El resultado (`result.skippedF2` / `job.result.skippedF2`) y la vista previa (`alreadyF2Count`) lo informan: "N guías ya están en la carga F2; no se agregan como paquete". Orden inverso (master primero, luego F2) ya lo resuelve la migración de escenario A del F2.

## Candado 2 — consolidado en otra sucursal

Función `ConsolidatedService.findActiveInOtherSubsidiary(consNumber, subsidiaryId)` → `{ subsidiaryName, createdByName, createdAt } | null` (consNumber normalizado TRIM/UPPER, `active=1`, `subsidiaryId <> actual`, cualquier tipo). Se llama al inicio de master (ambos caminos, incluido `ImportJobsService.create` para rechazar antes de encolar) y F2 (ambas funciones) → `BadRequestException`:
"Este consolidado ya se subió en {sucursal} ({quién}, {fecha}). Si está en la sucursal equivocada, pide el cambio de sucursal o la eliminación desde Consolidados."
La vista previa devuelve `otherSubsidiary` para avisarlo antes de subir.

## Candado 3 — estatus finales

`FINAL_STATUSES = [ENTREGADO, DEVUELTO_A_FEDEX]` (enum compartido, `isFinalStatus()`).
- Selección de candidatos: `getShipmentsToValidate`/`getSimpleChargeShipments` ya los excluyen por su lista de estatus.
- `processMasterFedexUpdate` / `processChargeFedexUpdate`: al cargar (`find` por ids) se excluyen registros finales → no se escribe historial, estatus ni ingreso (cubre monitoreo por consolidado/despacho/desembarque, que llaman a estas funciones).
- `checkStatusOnFedexChargeShipment` (desembarque): toma el registro vigente (activo, más reciente) y no toca finales (antes sobrescribía el estatus sin protección).
- Motor nuevo: `PersistentSyncSink.applyPlan` no escribe nada si el estatus actual es final (cubre cron, barrida, cierre de ruta y re-sync); `TerminalLockRule` deja de permitir "ENTREGADO siempre gana" sobre ENTREGADO/DEVUELTO_A_FEDEX (los demás terminales sí pueden pasar a ENTREGADO).
- Ingresos: como los finales ya no llegan a `processMaster/Charge` ni a `applyPlan`, no se generan cobros nuevos para ellos.
- Correcciones manuales (Consolidador `status_fix`, alta manual, devoluciones manuales) NO pasan por estos caminos: siguen funcionando.

## Candado 4 — entrega fantasma

Función pura `isPhantomDelivery(events, dl)` en `src/common/phantom-delivery.util.ts`: un evento DL es fantasma si existe un evento POSTERIOR con tipo de movimiento `PU | DP | AR | AF | IT | OD | DE`-tránsito (`eventType`/`derivedStatusCode` ∈ {PU, DP, AR, AF, IT, OD}). Se aplica:
- Legacy (`processMasterFedexUpdate`, `processChargeFedexUpdate`, `processShipment` al subir): los DL fantasma se descartan antes de calcular estatus final e ingresos (siguen como evento en el historial con nota "Entrega sin efecto (FedEx siguió moviendo el paquete)").
- Motor nuevo: el normalizador marca el DL fantasma con estatus EN_TRANSITO/PENDIENTE (no ENTREGADO) para que `latest` y las reglas de ingreso no lo tomen.

## Fuera de alcance

Limpieza de datos (parte C): ingresos ya creados por estos casos, y los 206 ingresos con evento >7 días antes del consolidado (Navojoa/Álamos).

## Pruebas

- `phantom-delivery.util.spec.ts` (casos reales 383915660048: DL 30-09 16:56 seguido de DP/AR → fantasma; entrega real sin movimiento después → no fantasma).
- `findActiveInOtherSubsidiary` + guards: master/F2/job rechazan con mensaje; misma sucursal no bloquea; inactivo no bloquea.
- Candado 1: master omite guías F2 del mismo consNumber (ambos caminos), cuenta `skippedF2`.
- Finales: processMaster/Charge no tocan entregado/devuelto; TerminalLockRule no revive devuelto; buildContext null.

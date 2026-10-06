# Acciones sobre el consolidado con autorización (borrar · cambiar sucursal · cambiar fecha)

Fecha: 2026-10-06 · Rama: `feat/consolidado-acciones` (pmy-api + app-pmy) · Parte A de 3 (B = candados de subida, C = limpieza semana 28-sep).

## Problema

1. **El borrado de consolidados "no funciona".** Caso real 305821198046 (Cabo, duplicado de Vía Larga): Marisol lo pidió el 30-09 y se autorizó; quedaron `active=0` el consolidado y sus guías, pero:
   - los **50 ingresos siguieron activos** ($6,100) — el borrado no toca `income`;
   - el **cron siguió procesando las guías dadas de baja**: 41 estatus nuevos y **2 ingresos más** después de autorizar;
   - no toca la carga F2 (`charge`) ni su ingreso;
   - el borrado actúa sobre UN `consolidated.id`, pero un mismo número puede tener 2 filas (master + F2, ej. 305820438524); la solicitud del 05-10 (305821955527) apunta a un id que ya no existe mientras otra fila con ese número sigue activa.
2. No existe forma de **cambiar la sucursal** ni la **fecha** de un consolidado; hoy se corrige directo en BD (caso 305820954693: guías movidas Obregón→Cabo, ingresos quedaron en Obregón), sin rastro en la bitácora.

## Decisiones del usuario

- Orden de trabajo A → B → C.
- Cambiar sucursal lo autoriza el **supervisor de la sucursal DESTINO**; borrar y cambiar fecha, el de la sucursal del consolidado. Superadmin siempre puede.
- Con guías que ya salieron a ruta o con cierre: **permitir con aviso** (no bloquear). Salidas/cierres/inventarios históricos NO se modifican.
- Cambiar fecha: el ingreso de la carga F2 **se mueve y se recalcula** con las reglas del día nuevo.

## Alcance de una acción: la "familia" del consolidado

Toda acción aplica a **todas las filas `consolidated` con el mismo `consNumber` (TRIM/UPPER) y la misma sucursal**, activas. A partir de ellas:

- `shipment` con `consolidatedId` ∈ familia.
- `charge_shipment` con `consolidatedId` ∈ familia.
- `charge` referenciadas por esos `charge_shipment.chargeId`, **más** `charge` con el mismo `consNumber` y sucursal (la F2 migrada no siempre lleva consolidatedId).
- `income` activos con `shipmentId` ∈ shipments, o `chargeId` ∈ charges.
- `devolution` con `consolidatedId` ∈ familia (solo cambio de sucursal).

La familia se carga en el servicio (`ConsolidatedFamilyLoader`, con BD); el **plan** de cambios lo arman funciones puras testeadas que reciben la familia en memoria.

## Flujo común

1. **Pedir** (cualquier usuario con acceso al consolidado): `POST /approvals` con `type`, `targetId` (cualquier fila de la familia), `justification` (obligatoria, ≥ 10 caracteres) y `payload` (`{ newSubsidiaryId }` o `{ newDate: 'yyyy-MM-dd' }`). Valida:
   - la familia existe y está activa;
   - no hay otra solicitud **pendiente** para la misma familia (cualquier tipo);
   - cambio de sucursal: destino ≠ origen, destino activo, y el destino **no** tiene ya una familia activa con ese `consNumber` (en ese caso lo correcto es borrar el duplicado) → 400 con mensaje en llano;
   - cambio de fecha: fecha válida, no futura (día Hermosillo), distinta a la actual.
   Guarda snapshot de impacto (antes/después) y notifica al aprobador.
2. **Aprobador**: `delete_consolidado`, `change_date_consolidado` → supervisor de la sucursal del consolidado; `change_subsidiary_consolidado` → supervisor del destino. Fallback: primer superadmin activo.
3. **Autorizar**: solo el aprobador o un superadmin; **nadie autoriza su propia solicitud** salvo superadmin. Se recalcula el plan y se aplica **en una sola transacción**. Si falla: rollback, la solicitud sigue `pendiente` con `executionError` visible; nada cambia.
4. **Rechazar**: motivo obligatorio (ya existe).

## Acciones

### Borrar (`delete_consolidado`, corregido)
- `consolidated.active=0` (toda la familia), `shipment.active=0`, `charge_shipment.active=0`, `charge.active=0` (columna nueva).
- **Anula ingresos**: `active=0`, `annulledAt=now`, `annulledById=aprobador`, `editReason='Baja de consolidado <n>: <justificación>'`, `updatedById/updatedAt`.
- Nada dado de baja vuelve a procesarse: filtros `active=1` en la selección de candidatos de **todos** los procesos que consultan FedEx/DHL o generan ingresos:
  - legacy: `getShipmentsToValidate`, `getSimpleChargeShipments`, `getDhlToPollNative`, actualización por consolidado/despacho/sucursal (`updateFedexDataBy*`);
  - motor nuevo: `RouteUniverseService` (todos sus universos) y reconciliador diario;
  - defensa en profundidad: `generateIncomes` y la creación de ingreso de carga no crean ingreso si la guía/carga está inactiva.
- No se tocan: salidas a ruta, cierres, inventarios, desembarques, cobros (`payment`) — quedan ligados a la guía inactiva.

### Cambiar sucursal (`change_subsidiary_consolidado`)
- `consolidated.subsidiaryId`, `charge.subsidiaryId`, `devolution.subsidiaryId` → destino.
- `shipment` / `charge_shipment`: → destino **solo** los que hoy están en la sucursal origen (los traspasados operativamente a otra sucursal se respetan).
- `income` activos de la familia → `subsidiaryId` destino y **costo recalculado** con la tarifa del destino; `originalCost` se llena si estaba vacío:
  - ingreso de guía: `fedexCostPackage` (FedEx) / `dhlCostPackage` (DHL) del destino;
  - ingreso de carga: `resolveChargeCost(destino, charge.isHalfTon, domingo/festivo(día de la carga), secondAbordApplied actual como override)`; si el ingreso estaba con `chargeNotChargedSameDay=1` se conserva en 0;
  - ingresos de devolución/otros `sourceType` de la familia: solo sucursal, costo igual.
- Costo destino = 0 → se mueve igual y el impacto lo marca con advertencia ("la sucursal destino no tiene tarifa").

### Cambiar fecha (`change_date_consolidado`)
- `consolidated.date` y `charge.chargeDate` de la familia → `newDate` a 00:00Z (misma convención actual: día-solo guardado como medianoche UTC).
- Ingresos **de carga** activos de la familia: `date` → `newDate` 00:00Z y costo recalculado con `resolveChargeCost` sobre el día nuevo (domingo/festivo incl. festivos de la tabla `holiday`) y la regla "solo 1ra carga del día" (si la sucursal la tiene y ya existe OTRA carga cobrada ese día → cost=0 y `chargeNotChargedSameDay=1`).
- Ingresos por paquete (POD/DEX): sin cambio (van con la fecha del evento FedEx).

## Bitácora (3 niveles)

1. **`approval_request`** (columnas nuevas): `justification` text, `payload` json, `impactAfter` json (impacto recalculado al aprobar), `resultSummary` json (conteos aplicados), `executedAt` datetime, `executionError` text, `targetLabel` varchar. `type` admite los 3 valores nuevos. Ya tenía: solicitante, aprobador, estatus, motivo de rechazo, fechas.
2. **`consolidated_change_log`** (tabla nueva): una fila por registro cambiado — `approvalRequestId`, `action`, `consNumber`, `entityType` (consolidated|shipment|charge_shipment|charge|income|devolution), `entityId`, `trackingNumber`, `field`, `oldValue`, `newValue`, `userId`, `userName`, `createdAt`. Índices por `approvalRequestId` y `consNumber`. Inserción en lote dentro de la misma transacción.
3. **`audit_log`** (módulo CONSOLIDADOS) vía `AuditService.log`: `consolidado_accion_solicitada`, `..._autorizada`, `..._rechazada`, `..._error`, con `beforeState/afterState` (impacto) y `metadata` (requestId, justificación, payload). Además cada ingreso tocado se registra en la bitácora del Consolidador (`ConsolidadorIncomeAudit.record`) para que su historial lo muestre.

Endpoints de lectura: `GET /approvals/history/consolidated?consNumber=&subsidiaryId=` (solicitudes + log de cambios).

## UI (app-pmy, solo shadcn + Tailwind, textos en llano)

- **Lista de consolidados** (`app/operaciones/consolidados/columns.tsx`): el botón de eliminar actual se reemplaza por un `DropdownMenu` "Más acciones" con **Eliminar**, **Cambiar sucursal**, **Cambiar fecha** e **Historial**.
- **Diálogo de acción** (uno, parametrizado por tipo): impacto (guías, cargas, ingresos y monto antes→después, cuántas en ruta/cerradas como aviso), selector de sucursal destino o fecha, **justificación obligatoria** (validación bajo el campo), quién va a autorizar, botón "Enviar a autorización".
- **Bandeja de autorizaciones** (`approval-tray`): muestra tipo, consolidado, cambio pedido (sucursal A→B / fecha A→B), justificación, impacto y solicitante; error de ejecución si lo hubo.
- **Historial**: diálogo con las solicitudes de la familia (quién pidió, cuándo, por qué, quién autorizó/rechazó) y la tabla de cambios (DataTable) con filtro por tipo de registro.

## Errores

Mensajes en español llano (400/403/404): "Ya hay una solicitud pendiente para este consolidado", "La sucursal destino ya tiene este consolidado; elimina el duplicado en lugar de moverlo", "No puedes autorizar tu propia solicitud", "La fecha no puede ser futura", "Escribe por qué (mínimo 10 caracteres)". Fallo al aplicar → 500 traducido + `executionError` en la solicitud.

## Pruebas

- Puras: `planDelete`, `planChangeSubsidiary`, `planChangeDate` (entrada: familia en memoria + tarifas; salida: lista de cambios por entidad + resumen). Casos: traspasados se respetan, costo destino 0, ingreso carga con skip mismo día, 1.5 ton, domingo/festivo, 2º a bordo.
- Servicio: auto-aprobación bloqueada, destino duplicado bloqueado, pendiente duplicada, rollback si falla (solicitud queda pendiente con error), aprobador correcto por tipo.
- Filtros `active`: specs de los selectores de candidatos.
- Verificación en BD local con 305821198046 (borrar → 50+2 ingresos anulados, cron ya no lo toma).

## Migraciones

- `093` `charge.active` (tinyint default 1) + columnas nuevas de `approval_request` + tabla `consolidated_change_log`.

## Fuera de alcance

Candados de subida (parte B), limpieza de datos de la semana (parte C), revertir una acción ya aplicada (se hace con otra solicitud).

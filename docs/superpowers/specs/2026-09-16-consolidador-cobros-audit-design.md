# Auditoría de cobros en el Consolidador — Diseño

Fecha: 2026-09-16 · Rama: main

## Objetivo
Nueva sección en el Consolidador (por **sucursal + semana**) que detecta, sobre guías
FedEx **de envío**, paquetes mal cobrados en **ambas direcciones**, revisando cada regla:
- **Falta ingreso** (debería cobrar y no cobra).
- **Ingreso de más** (cobra y no debería) — caso central: **DEX08 cobrado sin 3 visitas**.

Solo lectura, independiente del motor (legacy o cutover) → sirve además de red de seguridad
del cutover. La reparación puntual ya existe (`repair-income` / `delete income`).

## Reglas auditadas (FedEx envío)
Todo restringido a eventos/ingresos con fecha dentro de la semana ISO [from,to] (lun–dom).

| Regla | Falta ingreso | Ingreso de más |
|---|---|---|
| **Entregado** | evento `entregado` en la semana, sin `Income` entregado (activo) | `Income` entregado sin evento entregado en la semana y `shipment.status ≠ entregado` |
| **No entregado (07 / DEX08)** | (evento `07`/rechazado **o** 3 días-08 distintos) sin `Income` no_entregado | `Income` no_entregado **sin** justificación (ni 07 ni 3 días-08) |

- El lado no-entregado se evalúa junto porque 07 y DEX08 generan el mismo `incomeType`
  (`no_entregado`). La atribución de regla usa `income.nonDeliveryStatus` cuando existe.
- DEX08 "debería cobrar" = **3 días calendario distintos** con `08` en la semana ISO
  (reusa `weeklyDex08ChargeIndexes`, mismo criterio que el cobro real).
- Guías que también son F2 (cobro agrupado) se **marcan** `isF2` (no se excluyen; el FE las
  de-enfatiza para evitar falsos positivos).
- Solo `Income.active = 1`.

## Arquitectura

### Backend (pmy-api)
- `src/consolidador/logic/cobros-audit.util.ts` (**puro**) + spec — clasifica una guía dada
  sus eventos e ingresos de la semana. Devuelve `CobroFinding[]` (`rule`, `discrepancy`, `reason`).
  Aquí viven los tests de la lógica de dinero (incl. reverso DEX08).
- `src/consolidador/audit/cobros-audit.service.ts` — SQL scoped a sucursal+semana (calca
  `CobrosReconciliationService`): junta eventos e ingresos de la semana por guía y delega al util.
  Devuelve `{ window, subsidiary, rules: [{rule, missing[], extra[], okCount}], totals }`.
- Controller: `GET consolidador/:subsidiaryId/:fromDate/:toDate/cobros-audit`
  (guard `ConsolidadorAccessGuard`, fechas lun–dom expandidas a inicio/fin de día).

### Frontend (app-pmy)
- Pestaña **"Auditoría de cobros"** en `app/finanzas/consolidador/page.tsx` (shadcn `Tabs`:
  *Ingresos* | *Auditoría*), reusa sucursal+semana del toolbar.
- `components/consolidador/cobros-audit-panel.tsx`: KPIs por regla (OK / faltan / sobran) +
  `DataTable` (guía, regla, tipo de descuadre, estatus, fecha, costo esperado, F2).
- `hooks/services/consolidador/use-cobros-audit.ts`. Solo shadcn+Tailwind, dentro de
  AppLayout+withAuth+OperationHeader.

## No-objetivos
- No F2 ni DHL (segunda pasada).
- No acciones de reparación en esta entrega (se enlazan a las existentes después).

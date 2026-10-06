# Acciones sobre consolidado con autorización — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (el usuario pidió ejecución INLINE en la misma sesión). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Borrar (corregido), cambiar sucursal y cambiar fecha de un consolidado mediante solicitud justificada + autorización, aplicando la cascada completa (consolidado, guías, guías de carga, cargas, ingresos, devoluciones) con bitácora en 3 niveles.

**Architecture:** Se extiende `src/approvals`. La familia (todas las filas con mismo consNumber+sucursal) se carga con BD en `ConsolidatedFamilyLoader`; funciones PURAS (`consolidated-actions.plan.ts`) devuelven un plan = lista de `FieldChange` + resumen; `ConsolidatedActionsExecutor` aplica el plan en UNA transacción y escribe `consolidated_change_log`, `income_change_log` y `audit_log`. Los procesos FedEx/DHL ignoran registros `active=0`.

**Tech Stack:** NestJS 10 + TypeORM (MySQL), Jest; Next.js (app-pmy) + shadcn/ui + Tailwind, Vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-06-consolidado-acciones-design.md`.
- Esquema SOLO por migración (DB_SYNC=false). Migración nueva `1786000000093`.
- Textos visibles en español llano; sin tecnicismos. UI solo shadcn (`@/components/ui/*`) + Tailwind.
- Justificación obligatoria ≥ 10 caracteres en las 3 acciones de consolidado.
- Nadie autoriza su propia solicitud salvo superadmin (`superadmin`/`superamin`).
- Día-solo se guarda como medianoche UTC (`yyyy-MM-ddT00:00:00.000Z`).
- Nunca borrar ingresos: anular (`active=0`, `annulledAt`, `annulledById`, `editReason`).
- Tras tocar código: `graphify update .`; resolver todos los errores tsc/tests de los archivos tocados.

---

### Task 1: Migración + entidades

**Files:**
- Create: `src/database/migrations/1786000000093-ConsolidatedActions.ts`
- Create: `src/entities/consolidated-change-log.entity.ts`
- Modify: `src/entities/charge.entity.ts` (+`active`)
- Modify: `src/entities/approval-request.entity.ts` (tipos + columnas)
- Modify: `src/app.module.ts` / data-source si registran entidades por lista (verificar con grep `IncomeChangeLog`).

**Produces:**
- `ApprovalType = 'delete_consolidado' | 'delete_route_dispatch' | 'change_subsidiary_consolidado' | 'change_date_consolidado'`
- `ApprovalRequest` + `justification: string|null`, `payload: any`, `targetKey: string|null` (index; `"<CONSNUM>|<subsidiaryId>"`), `targetLabel: string|null`, `impactAfter: any`, `resultSummary: any`, `executedAt: Date|null`, `executionError: string|null`.
- `ConsolidatedChangeLog { id, approvalRequestId, action, consNumber, entityType, entityId, trackingNumber, field, oldValue, newValue, userId, userName, createdAt }`.
- `Charge.active: boolean` (default true).

- [ ] Step 1: escribir migración (up/down) con `ALTER TABLE charge ADD active tinyint NOT NULL DEFAULT 1`, columnas de `approval_request`, índice `IDX_approval_request_targetKey`, `CREATE TABLE consolidated_change_log` (+ índices approvalRequestId, consNumber).
- [ ] Step 2: entidades. Step 3: registrar entidad nueva donde se registran las demás. Step 4: `npx tsc --noEmit` limpio en archivos tocados. Step 5: correr migración en BD local (`npm run migration:run` o el script del repo) y verificar columnas. Step 6: commit.

### Task 2: Plan puro (TDD)

**Files:**
- Create: `src/approvals/consolidated-actions.types.ts`
- Create: `src/approvals/consolidated-actions.plan.ts`
- Test: `src/approvals/consolidated-actions.plan.spec.ts`

**Produces (types):**
```ts
export type ChangeEntity = 'consolidated' | 'shipment' | 'charge_shipment' | 'charge' | 'income' | 'devolution';
export interface FamilyConsolidated { id: string; consNumber: string; subsidiaryId: string; date: Date }
export interface FamilyPackage { id: string; trackingNumber: string; subsidiaryId: string | null; shipmentType?: string | null }
export interface FamilyCharge { id: string; subsidiaryId: string | null; chargeDate: Date; isHalfTon: boolean }
export interface FamilyIncome {
  id: string; trackingNumber: string | null; subsidiaryId: string | null; sourceType: string;
  shipmentId: string | null; chargeId: string | null; cost: number; originalCost: number | null;
  date: Date; shipmentType: string | null; secondAbordApplied: boolean | null; chargeNotChargedSameDay: boolean;
}
export interface FamilyDevolution { id: string; trackingNumber: string; subsidiaryId: string | null }
export interface ConsolidatedFamily {
  consNumber: string; subsidiaryId: string;
  consolidated: FamilyConsolidated[]; shipments: FamilyPackage[]; chargeShipments: FamilyPackage[];
  charges: FamilyCharge[]; incomes: FamilyIncome[]; devolutions: FamilyDevolution[];
  enRuta: number; withRoute: number;
}
export interface SubsidiaryTariff {
  id: string; name: string; fedexCostPackage: number; dhlCostPackage: number;
  chargeCost: number; chargeCostHalfTon: number; chargeCostSundayHoliday: number; chargeCostHalfTonSundayHoliday: number;
  chargeSecondAbord: boolean; secondAbordAmount: number; chargeOnlyFirstOfDay: boolean;
}
export interface FieldChange { entityType: ChangeEntity; entityId: string; trackingNumber: string | null; field: string; oldValue: string | null; newValue: string | null; value: unknown }
export interface PlanSummary {
  consolidated: number; shipments: number; chargeShipments: number; charges: number; devolutions: number;
  incomesAnnulled: number; incomesMoved: number; incomesRecosted: number; incomesRedated: number;
  amountBefore: number; amountAfter: number;
}
export interface ActionPlan { changes: FieldChange[]; summary: PlanSummary; warnings: string[] }
```
**Produces (functions):**
```ts
planDelete(f: ConsolidatedFamily): ActionPlan
planChangeSubsidiary(f, dest: SubsidiaryTariff, isSundayHoliday: (day: string) => boolean): ActionPlan
planChangeDate(f, tariff: SubsidiaryTariff, newDay: string, isSundayHoliday: boolean, otherChargeIncomeOnDay: boolean): ActionPlan
dayOnlyUtc(day: string): Date   // 'yyyy-MM-dd' → Date 00:00Z
```
Reglas (de la spec): delete → `active=false` en consolidated/shipment/charge_shipment/charge + income `active=false`. changeSubsidiary → subsidiaryId en consolidated/charge/devolution; shipment/charge_shipment solo si `subsidiaryId === f.subsidiaryId`; income: subsidiaryId + cost recalculado (guía: fedex/dhl del destino; carga: `resolveChargeCost(dest, isHalfTon, isSundayHoliday(chargeDay), secondAbordApplied ?? undefined)`, si `chargeNotChargedSameDay` → 0; otros sourceType: costo igual), `originalCost` si null y cambia el costo; warning si tarifa destino = 0. changeDate → consolidated.date/charge.chargeDate = `dayOnlyUtc(newDay)`; ingresos `sourceType='charge'`: date + cost (`otherChargeIncomeOnDay && dest.chargeOnlyFirstOfDay` → 0 y `chargeNotChargedSameDay=true`, si no `resolveChargeCost(...)` y `chargeNotChargedSameDay=false`).

- [ ] Step 1: tests (casos: delete anula todo; move respeta traspasados; costo guía 64→122 con originalCost; carga con skip mismo día queda 0; tarifa destino 0 → warning; changeDate domingo con sobreprecio; changeDate con otra carga ese día y flag → 0; summary amounts).
- [ ] Step 2: correr → FAIL. Step 3: implementar. Step 4: PASS. Step 5: commit.

### Task 3: Loader de familia + impacto

**Files:**
- Create: `src/approvals/consolidated-family.loader.ts`
- Modify: `src/approvals/impact.service.ts` (impacto de consolidado por familia + plan before/after)
- Modify: `src/approvals/approvals.module.ts` (repos Charge, Income, Devolution, Holiday service, ConsolidatedChangeLog, IncomeChangeLog, PackageDispatchHistory)

**Produces:**
- `ConsolidatedFamilyLoader.load(targetId: string, manager?: EntityManager): Promise<ConsolidatedFamily>` (404 si no existe; 400 si la familia ya no tiene filas activas).
- `ConsolidatedFamilyLoader.loadTariff(subsidiaryId, manager?): Promise<SubsidiaryTariff>`
- `ConsolidatedFamilyLoader.otherChargeIncomeOnDay(subsidiaryId, day, excludeChargeIds, manager?): Promise<boolean>`
- `ApprovalImpactService.buildConsolidatedAction(type, targetId, payload): Promise<ConsolidatedImpact>` donde `ConsolidatedImpact = ImpactSnapshot & { consNumber, subsidiaryId, subsidiaryName, targetKey, summary: PlanSummary, warnings: string[], change?: { from: string; to: string } }`.

- [ ] Steps: implementar; spec con repos mockeados para `load` (familia = filas mismo consNumber normalizado + sucursal, activas; charges por chargeId de charge_shipments ∪ charge mismo consNumber+sucursal; incomes activos por shipmentId/chargeId); tsc; commit.

### Task 4: Executor transaccional + bitácora

**Files:**
- Create: `src/approvals/consolidated-actions.executor.ts`
- Test: `src/approvals/consolidated-actions.executor.spec.ts`

**Produces:** `ConsolidatedActionsExecutor.apply(manager: EntityManager, plan: ActionPlan, ctx: { requestId: string; action: ApprovalType; consNumber: string; actor: ApprovalActor; reason: string }): Promise<void>`
- Agrupa `plan.changes` por (entityType, entityId) → `manager.update(Entity, id, patch)`; income: agrega `updatedById/updatedAt/editReason`; si `active=false`: `annulledAt/annulledById`.
- Inserta `ConsolidatedChangeLog` en lote (chunks de 200) e `IncomeChangeLog` por cada cambio de income (`action`: delete→'delete', subsidiary→'reassign', cost→'cost_edit', date→'date_edit').
- Spec: manager mockeado → verifica patches agrupados y filas de log.

### Task 5: ApprovalsService + controller

**Files:** Modify `src/approvals/approvals.service.ts`, `src/approvals/approvals.controller.ts`, `src/approvals/approvals.service.spec.ts`.

- `createRequest({ type, targetId, actor, justification?, payload? })`: para tipos de consolidado exige justificación ≥10 (`BadRequestException('Escribe por qué (mínimo 10 caracteres).')`), valida payload, pendiente por `targetKey`, destino duplicado, fecha futura; aprobador: destino para change_subsidiary, sucursal de la familia para el resto; guarda `targetKey`, `targetLabel`, `justification`, `payload`, `impactSnapshot`; `audit.log(CONSOLIDADOS, OTHER, 'Solicitó …')`; notifica.
- `approve`: `loadForDecision` bloquea auto-aprobación (`ForbiddenException('No puedes autorizar tu propia solicitud.')`) salvo superadmin; consolidado → `dataSource.transaction(manager => { family = loader.load(targetId, manager); plan = …; executor.apply(...) })`; ok → `status='aprobado'`, `executedAt`, `impactAfter`, `resultSummary`; error → `executionError`, sigue pendiente, `audit.log(result FAILURE)`, relanza `InternalServerErrorException('No se pudo aplicar el cambio: …')`. `delete_route_dispatch` sin cambios.
- `reject`: además `audit.log`.
- `history(consNumber, subsidiaryId)`: solicitudes por `targetKey` + `ConsolidatedChangeLog` por consNumber (y por requestId de esas solicitudes).
- Controller: body `{ type, targetId, justification?, payload? }`; `GET /approvals/impact` acepta `payload` (JSON string) ; `GET /approvals/history/consolidated?consNumber&subsidiaryId`.
- Tests: auto-aprobación bloqueada; aprobador = supervisor destino; justificación corta 400; pendiente duplicada 400; rollback deja `executionError`.

### Task 6: Procesos ignoran dados de baja

**Files:** Modify `src/shipments/shipments.service.ts` (`getShipmentsToValidate`, `getSimpleChargeShipments`, `getDhlToPollNative`, `processMasterFedexUpdate` y `processChargeFedexUpdate` filtran entradas con `active === false`, `generateIncomes` retorna si `shipment.active === false`, alta de ingreso de carga no aplica a charge inactiva); `src/tracking-sync/route-universe.service.ts` (`s.active = 1`, `c.active = 1`); `src/tracking-sync/tracking-compare.service.ts` (`buildContext` → null si `entity.active === false`).
- [ ] Tests: spec mínimo para `generateIncomes` (inactiva no crea) y route-universe (query incluye active); suites existentes verdes; commit.

### Task 7: Front — servicios + diálogo + menú + historial + bandeja

**Files (app-pmy):**
- Modify `lib/services/approvals.ts` (tipos nuevos, `requestApproval(type, targetId, opts?: { justification?: string; payload?: any })`, `getApprovalImpact(type, targetId, payload?)`, `getConsolidatedHistory(consNumber, subsidiaryId)`).
- Create `components/approvals/consolidated-action-dialog.tsx` (tipo: eliminar/sucursal/fecha; selector sucursal con el catálogo existente de sucursales; input fecha; impacto antes→después; justificación con validación bajo el campo; quién autoriza).
- Create `components/approvals/consolidated-actions-menu.tsx` (`DropdownMenu` "Más acciones").
- Create `components/approvals/consolidated-history-dialog.tsx` (solicitudes + DataTable de cambios).
- Modify `components/approvals/approval-tray.tsx` (etiqueta por tipo, cambio pedido, justificación, error).
- Modify `app/operaciones/consolidados/columns.tsx` (menú en lugar del botón de borrar).
- [ ] tsc del front en archivos tocados; vitest si se agrega util; commit.

### Task 8: Verificación end-to-end en BD local + cierre

- [ ] Migración 093 corrida en local.
- [ ] Script/llamada de servicio sobre la familia 305821198046 (Cabo, ya `active=0` el consolidado → reactivar NO; usar en su lugar una familia de prueba o validar con `planDelete` sobre datos reales leídos) — verificar que el plan anula 52 ingresos.
- [ ] Levantar API local y probar el flujo por HTTP (solicitar → autorizar con otro usuario) sobre un consolidado de prueba; revisar filas en `consolidated_change_log`, `income_change_log`, `audit_log`.
- [ ] `graphify update .` en ambos repos; memoria actualizada; commit final.

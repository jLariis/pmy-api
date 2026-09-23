# Mantenimiento de Vehículos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Módulo de mantenimiento de flota: catálogos (categorías, servicios, proveedores), solicitudes con cotizaciones comparables, órdenes de compra con autorización exclusiva, PDF institucional y envío por correo/WhatsApp, cierre con gasto e historial; más km vivo del vehículo y páginas Programación/Historial.

**Architecture:** Backend NestJS módulo `src/maintenance` (servicios por agregado + utils puras testeadas), entidades TypeORM registradas por glob, esquema por migración 074/075. Frontend Next (app-pmy) páginas bajo el menú "Mtto. Vehículos", SWR hooks + `lib/services/maintenance.ts`, solo shadcn + Tailwind + DataTable.

**Tech Stack:** NestJS 10, TypeORM (MySQL), Jest; Next.js + SWR + shadcn/ui, Vitest; Handlebars (documents) + html-to-pdf; Baileys (whatsapp-gateway); nodemailer (mail).

Spec: `docs/superpowers/specs/2026-09-22-mtto-vehiculos-design.md`

## Global Constraints

- Esquema SOLO por migración (`DB_SYNC=false` en todos los entornos). Migraciones idempotentes (`columnExists`/`CREATE TABLE IF NOT EXISTS`), nombre `1786000000074-…`, `1786000000075-…`.
- Rama `feat/mtto-vehiculos` en pmy-api y app-pmy. Commits con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- UI: toda pantalla dentro de `AppLayout` + `withAuth(Page, "<permiso>")` + `OperationHeader` + `SucursalSelector`, solo `@/components/ui/*` + Tailwind, listas con `DataTable`. Textos en lenguaje simple (sin tecnicismos).
- Permisos: `mttoVehiculos.programacion`, `mttoVehiculos.historial` (existen), nuevos `mttoVehiculos.solicitudes`, `mttoVehiculos.ordenes`, `mttoVehiculos.catalogos` (admin, superadmin), `mttoVehiculos.autorizar` (sin roles; user_permission a Edgardo; superadmin pasa por bypass del `PermissionsGuard`).
- Umbrales: intervalo default 5000 km; "Próximo" ≤ 1000 km o ≤ 15 días; desviación de precio default 15 %; salto máximo de km 5000.
- IVA default 0.16. Montos `decimal(12,2)`.
- Gasto al completar: categoría de gastos existente **"Mantenimiento"** (se busca por nombre; si no existe se crea).
- Helpers espejados FE↔BE (`maintenance-status`) deben mantenerse en sync.
- Al terminar cada tarea: `npx tsc --noEmit` limpio en archivos tocados y `graphify update .`.

---

## File Structure

**pmy-api**
- `src/database/migrations/1786000000074-CreateMaintenanceModule.ts` — tablas, columnas vehicle/company_settings, semilla de categorías, backfill km.
- `src/database/migrations/1786000000075-SyncMaintenancePermissions.ts` — catálogo RBAC + user_permission Edgardo.
- `src/auth/rbac/permission-catalog.ts` — nuevos códigos.
- `src/common/enums/audit.enum.ts` — `AuditModule.MANTENIMIENTO`.
- `src/entities/maintenance/*.entity.ts` — ver Task 2 (glob `entities/*.entity` NO es recursivo → los archivos van en `src/entities/` directo con prefijo `maintenance-`).
- `src/maintenance/utils/` — `vehicle-kms.util.ts`, `maintenance-status.util.ts`, `po-state.util.ts`, `money.util.ts`, `whatsapp-number.util.ts`, `amount-to-words.util.ts` (+ `.spec.ts` c/u).
- `src/maintenance/catalog/` — categorías + servicios (service/controller/dto).
- `src/maintenance/suppliers/` — proveedores + contactos.
- `src/maintenance/requests/` — solicitudes + cotizaciones + adjuntos.
- `src/maintenance/purchase-orders/` — órdenes, transición, autorización, completar.
- `src/maintenance/dispatch/` — PDF + envío correo/WhatsApp.
- `src/maintenance/schedule/` — programación e historial.
- `src/maintenance/folio.service.ts`, `src/maintenance/maintenance.module.ts`.
- `src/documents/seeds/templates/purchase-order.pdf.html.ts` + registro en `pdf-templates.seed.ts`.
- `src/whatsapp-gateway/whatsapp-gateway.service.ts` — `sendDocument`.
- `src/mail/mail.service.ts` — `sendPurchaseOrderEmail`.
- `src/package-dispatch/package-dispatch.service.ts`, `src/routeclosure/routeclosure.service.ts` — km vivo.
- `src/notifications/notification-catalog.ts` — `mtto.oc_por_autorizar`, `mtto.oc_autorizada`, `mtto.oc_rechazada`.
- `src/support/module-directory.ts` — entradas nuevas.

**app-pmy**
- `lib/types/maintenance.ts`, `lib/services/maintenance.ts`, `hooks/services/maintenance/*.ts`.
- `lib/maintenance-status.ts` (+ `lib/maintenance-status.test.ts`).
- `app/programacion-mtto/page.tsx`, `app/historial-mtto/page.tsx`, `app/mtto/solicitudes/page.tsx`, `app/mtto/solicitudes/[id]/page.tsx`, `app/mtto/cotizaciones/page.tsx`, `app/mtto/ordenes/page.tsx`, `app/mtto/ordenes/[id]/page.tsx`, `app/mtto/catalogos/page.tsx`.
- `components/maintenance/*` — diálogos y paneles.
- `components/maintenance/po-authorization-tray.tsx` + montaje en `components/app-layout.tsx`.
- `lib/constants.ts`, `lib/access/allowed-page-roles.ts`.

> **Nota next.js:** verificar si la app usa `output: export` (hay carpeta `out/`). Si es export estático, las rutas dinámicas `[id]` requieren `generateStaticParams`; en ese caso usar `?id=` en páginas estáticas (`/mtto/solicitudes/detalle?id=`). Task 12 lo verifica primero.

---

## FASE 1 — Base, catálogos, km vivo, Programación

### Task 1: Utils puras (km, semáforo, estados, dinero, WhatsApp, letra)

**Files:**
- Create: `src/maintenance/utils/vehicle-kms.util.ts`, `maintenance-status.util.ts`, `po-state.util.ts`, `money.util.ts`, `whatsapp-number.util.ts`, `amount-to-words.util.ts`
- Test: mismo nombre `.spec.ts`

**Interfaces (Produces):**
```ts
export const MAX_KMS_JUMP = 5000;
export function parseKms(v: unknown): number | null;
export function nextVehicleKms(current: number | null | undefined, captured: unknown): { kms: number | null; changed: boolean; reason?: 'invalid' | 'not_greater' | 'jump' };

export type MaintenanceLight = 'vencido' | 'proximo' | 'al_dia' | 'sin_datos';
export interface MaintenanceStatusInput { kms?: number | null; lastMaintenanceKms?: number | null; maintenanceIntervalKms?: number | null; nextMaintenanceDate?: string | Date | null; }
export interface MaintenanceStatusResult { light: MaintenanceLight; nextKms: number | null; kmsRemaining: number | null; daysRemaining: number | null; }
export const PROXIMO_KMS = 1000; export const PROXIMO_DAYS = 15; export const DEFAULT_INTERVAL_KMS = 5000;
export function maintenanceStatus(v: MaintenanceStatusInput, today?: Date): MaintenanceStatusResult;

export type PoStatus = 'borrador'|'pendiente'|'autorizada'|'rechazada'|'enviada'|'completada'|'cancelada';
export function canTransition(from: PoStatus, to: PoStatus): boolean;
export function assertTransition(from: PoStatus, to: PoStatus): void; // BadRequestException
export function canEditItems(status: PoStatus, isAuthorizer: boolean): boolean;
export function canDelete(status: PoStatus): boolean;

export interface MoneyItem { quantity: number; unitPrice: number; taxRate?: number; approved?: boolean }
export function round2(n: number): number;
export function itemAmount(i: MoneyItem): number;              // quantity*unitPrice (sin IVA)
export function totals(items: MoneyItem[], onlyApproved?: boolean): { subtotal: number; tax: number; total: number };
export function deviationPct(unitPrice: number, referencePrice?: number | null): number | null;

export function toWhatsappNumber(raw: string): string | null; // '52'+10 dígitos o null
export function amountToWordsMXN(n: number): string;          // "MIL DOSCIENTOS PESOS 50/100 M.N."
```

- [ ] **Step 1: Tests**

```ts
// vehicle-kms.util.spec.ts
import { nextVehicleKms, parseKms } from './vehicle-kms.util';
describe('nextVehicleKms', () => {
  it('sube si es mayor', () => expect(nextVehicleKms(1000, '1200')).toEqual({ kms: 1200, changed: true }));
  it('ignora menor o igual', () => expect(nextVehicleKms(1000, 900)).toEqual({ kms: 1000, changed: false, reason: 'not_greater' }));
  it('ignora no numérico', () => expect(nextVehicleKms(1000, 'abc')).toEqual({ kms: 1000, changed: false, reason: 'invalid' }));
  it('ignora salto > 5000', () => expect(nextVehicleKms(1000, 7001)).toEqual({ kms: 1000, changed: false, reason: 'jump' }));
  it('sin km previo acepta cualquiera válido', () => expect(nextVehicleKms(null, '85,300')).toEqual({ kms: 85300, changed: true }));
  it('parseKms limpia separadores', () => expect(parseKms('12,345 km')).toBe(12345));
});
// maintenance-status.util.spec.ts
import { maintenanceStatus } from './maintenance-status.util';
const today = new Date('2026-09-22T12:00:00Z');
describe('maintenanceStatus', () => {
  it('sin datos', () => expect(maintenanceStatus({ kms: 100 }, today).light).toBe('sin_datos'));
  it('vencido por km', () => expect(maintenanceStatus({ kms: 15100, lastMaintenanceKms: 10000, maintenanceIntervalKms: 5000 }, today).light).toBe('vencido'));
  it('proximo por km', () => expect(maintenanceStatus({ kms: 14200, lastMaintenanceKms: 10000 }, today)).toMatchObject({ light: 'proximo', nextKms: 15000, kmsRemaining: 800 }));
  it('vencido por fecha', () => expect(maintenanceStatus({ kms: 1, lastMaintenanceKms: 0, nextMaintenanceDate: '2026-09-01' }, today).light).toBe('vencido'));
  it('proximo por fecha', () => expect(maintenanceStatus({ nextMaintenanceDate: '2026-10-01' }, today).light).toBe('proximo'));
  it('al dia', () => expect(maintenanceStatus({ kms: 11000, lastMaintenanceKms: 10000, nextMaintenanceDate: '2026-12-01' }, today).light).toBe('al_dia'));
});
// po-state.util.spec.ts
import { canTransition, assertTransition, canEditItems, canDelete } from './po-state.util';
describe('po-state', () => {
  it.each([['borrador','pendiente'],['pendiente','autorizada'],['pendiente','rechazada'],['rechazada','borrador'],['autorizada','enviada'],['enviada','enviada'],['enviada','completada'],['autorizada','cancelada'],['enviada','cancelada']])('%s→%s ok', (a,b) => expect(canTransition(a as any,b as any)).toBe(true));
  it.each([['borrador','enviada'],['borrador','autorizada'],['completada','cancelada'],['autorizada','completada']])('%s→%s no', (a,b) => expect(canTransition(a as any,b as any)).toBe(false));
  it('assert lanza', () => expect(() => assertTransition('borrador','enviada')).toThrow());
  it('edición', () => { expect(canEditItems('borrador', false)).toBe(true); expect(canEditItems('pendiente', false)).toBe(false); expect(canEditItems('pendiente', true)).toBe(true); expect(canEditItems('autorizada', true)).toBe(true); expect(canEditItems('enviada', true)).toBe(false); });
  it('borrado', () => { expect(canDelete('borrador')).toBe(true); expect(canDelete('rechazada')).toBe(true); expect(canDelete('autorizada')).toBe(false); });
});
// money.util.spec.ts
import { totals, deviationPct, itemAmount } from './money.util';
describe('money', () => {
  const items = [{ quantity: 2, unitPrice: 100, approved: true }, { quantity: 1, unitPrice: 50.5, taxRate: 0, approved: false }];
  it('itemAmount', () => expect(itemAmount({ quantity: 3, unitPrice: 10.25 })).toBe(30.75));
  it('totales todas', () => expect(totals(items)).toEqual({ subtotal: 250.5, tax: 32, total: 282.5 }));
  it('solo aprobadas', () => expect(totals(items, true)).toEqual({ subtotal: 200, tax: 32, total: 232 }));
  it('desviación', () => { expect(deviationPct(1150, 1000)).toBe(15); expect(deviationPct(900, 1000)).toBe(-10); expect(deviationPct(900, null)).toBeNull(); });
});
// whatsapp-number.util.spec.ts
import { toWhatsappNumber } from './whatsapp-number.util';
describe('toWhatsappNumber', () => {
  it('10 dígitos', () => expect(toWhatsappNumber('(662) 123-4567')).toBe('526621234567'));
  it('con 52', () => expect(toWhatsappNumber('+52 662 123 4567')).toBe('526621234567'));
  it('con 521', () => expect(toWhatsappNumber('5216621234567')).toBe('526621234567'));
  it('inválido', () => expect(toWhatsappNumber('123')).toBeNull());
});
// amount-to-words.util.spec.ts
import { amountToWordsMXN } from './amount-to-words.util';
describe('amountToWordsMXN', () => {
  it('1200.50', () => expect(amountToWordsMXN(1200.5)).toBe('MIL DOSCIENTOS PESOS 50/100 M.N.'));
  it('1', () => expect(amountToWordsMXN(1)).toBe('UN PESO 00/100 M.N.'));
  it('21,345.07', () => expect(amountToWordsMXN(21345.07)).toBe('VEINTIÚN MIL TRESCIENTOS CUARENTA Y CINCO PESOS 07/100 M.N.'));
  it('1,000,000', () => expect(amountToWordsMXN(1000000)).toBe('UN MILLÓN DE PESOS 00/100 M.N.'));
});
```

- [ ] **Step 2: Run** `npx jest src/maintenance/utils` → FAIL (módulos no existen).

- [ ] **Step 3: Implementar**

```ts
// vehicle-kms.util.ts
export const MAX_KMS_JUMP = 5000;
export function parseKms(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}
export function nextVehicleKms(current: number | null | undefined, captured: unknown) {
  const cur = current ?? null;
  const cap = parseKms(captured);
  if (cap === null) return { kms: cur, changed: false, reason: 'invalid' as const };
  if (cur === null || cur === 0) return { kms: cap, changed: true };
  if (cap <= cur) return { kms: cur, changed: false, reason: 'not_greater' as const };
  if (cap - cur > MAX_KMS_JUMP) return { kms: cur, changed: false, reason: 'jump' as const };
  return { kms: cap, changed: true };
}
```
```ts
// maintenance-status.util.ts  (ESPEJO de app-pmy lib/maintenance-status.ts — mantener en sync)
export type MaintenanceLight = 'vencido' | 'proximo' | 'al_dia' | 'sin_datos';
export interface MaintenanceStatusInput { kms?: number | null; lastMaintenanceKms?: number | null; maintenanceIntervalKms?: number | null; nextMaintenanceDate?: string | Date | null; }
export interface MaintenanceStatusResult { light: MaintenanceLight; nextKms: number | null; kmsRemaining: number | null; daysRemaining: number | null; }
export const PROXIMO_KMS = 1000;
export const PROXIMO_DAYS = 15;
export const DEFAULT_INTERVAL_KMS = 5000;
const DAY = 86_400_000;
const dayStart = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
export function maintenanceStatus(v: MaintenanceStatusInput, today: Date = new Date()): MaintenanceStatusResult {
  const hasKms = v.lastMaintenanceKms !== null && v.lastMaintenanceKms !== undefined;
  const nextKms = hasKms ? Number(v.lastMaintenanceKms) + Number(v.maintenanceIntervalKms || DEFAULT_INTERVAL_KMS) : null;
  const kmsRemaining = nextKms !== null && v.kms !== null && v.kms !== undefined ? nextKms - Number(v.kms) : null;
  const date = v.nextMaintenanceDate ? new Date(v.nextMaintenanceDate) : null;
  const daysRemaining = date && !isNaN(date.getTime()) ? Math.round((dayStart(date) - dayStart(today)) / DAY) : null;
  if (nextKms === null && daysRemaining === null) return { light: 'sin_datos', nextKms, kmsRemaining, daysRemaining };
  let light: MaintenanceLight = 'al_dia';
  if ((kmsRemaining !== null && kmsRemaining <= 0) || (daysRemaining !== null && daysRemaining < 0)) light = 'vencido';
  else if ((kmsRemaining !== null && kmsRemaining <= PROXIMO_KMS) || (daysRemaining !== null && daysRemaining <= PROXIMO_DAYS)) light = 'proximo';
  return { light, nextKms, kmsRemaining, daysRemaining };
}
```
```ts
// po-state.util.ts
import { BadRequestException } from '@nestjs/common';
export type PoStatus = 'borrador'|'pendiente'|'autorizada'|'rechazada'|'enviada'|'completada'|'cancelada';
export const PO_STATUSES: PoStatus[] = ['borrador','pendiente','autorizada','rechazada','enviada','completada','cancelada'];
const T: Record<PoStatus, PoStatus[]> = {
  borrador: ['pendiente'], pendiente: ['autorizada', 'rechazada'], rechazada: ['borrador'],
  autorizada: ['enviada', 'cancelada', 'pendiente'], enviada: ['enviada', 'completada', 'cancelada'],
  completada: [], cancelada: [],
};
export const canTransition = (from: PoStatus, to: PoStatus) => T[from]?.includes(to) ?? false;
export function assertTransition(from: PoStatus, to: PoStatus) {
  if (!canTransition(from, to)) throw new BadRequestException(`No se puede pasar la orden de "${from}" a "${to}".`);
}
export const canEditItems = (s: PoStatus, isAuthorizer: boolean) => s === 'borrador' || (isAuthorizer && (s === 'pendiente' || s === 'autorizada'));
export const canDelete = (s: PoStatus) => s === 'borrador' || s === 'rechazada';
```
Nota: `autorizada → pendiente` existe para el caso "modificada por no autorizador" (spec); el test `autorizada→completada` sigue en false.
```ts
// money.util.ts
export interface MoneyItem { quantity: number; unitPrice: number; taxRate?: number | null; approved?: boolean }
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const itemAmount = (i: MoneyItem) => round2(Number(i.quantity) * Number(i.unitPrice));
export function totals(items: MoneyItem[], onlyApproved = false) {
  const list = onlyApproved ? items.filter((i) => i.approved !== false) : items;
  let subtotal = 0, tax = 0;
  for (const i of list) { const a = itemAmount(i); subtotal += a; tax += a * Number(i.taxRate ?? 0.16); }
  return { subtotal: round2(subtotal), tax: round2(tax), total: round2(round2(subtotal) + round2(tax)) };
}
export function deviationPct(unitPrice: number, referencePrice?: number | null): number | null {
  if (!referencePrice || Number(referencePrice) <= 0) return null;
  return round2(((Number(unitPrice) - Number(referencePrice)) / Number(referencePrice)) * 100);
}
```
```ts
// whatsapp-number.util.ts
export function toWhatsappNumber(raw: string): string | null {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('521') && d.length === 13) d = d.slice(3);
  else if (d.startsWith('52') && d.length === 12) d = d.slice(2);
  return d.length === 10 ? `52${d}` : null;
}
```
```ts
// amount-to-words.util.ts
const U = ['', 'UN', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE', 'VEINTE', 'VEINTIÚN', 'VEINTIDÓS', 'VEINTITRÉS', 'VEINTICUATRO', 'VEINTICINCO', 'VEINTISÉIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE'];
const D = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
const C = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];
function under100(n: number): string { if (n < 30) return U[n]; const d = Math.floor(n / 10), u = n % 10; return u ? `${D[d]} Y ${U[u]}` : D[d]; }
function under1000(n: number): string { if (n === 100) return 'CIEN'; const c = Math.floor(n / 100), r = n % 100; return [C[c], r ? under100(r) : ''].filter(Boolean).join(' '); }
function int(n: number): string {
  if (n === 0) return 'CERO';
  const m = Math.floor(n / 1_000_000), k = Math.floor((n % 1_000_000) / 1000), r = n % 1000;
  const parts: string[] = [];
  if (m) parts.push(m === 1 ? 'UN MILLÓN' : `${int(m)} MILLONES`);
  if (k) parts.push(k === 1 ? 'MIL' : `${under1000(k)} MIL`);
  if (r) parts.push(under1000(r));
  return parts.join(' ');
}
export function amountToWordsMXN(n: number): string {
  const v = Math.round(Number(n || 0) * 100);
  const i = Math.floor(v / 100), c = String(v % 100).padStart(2, '0');
  const words = int(i);
  const exactMillions = i >= 1_000_000 && i % 1_000_000 === 0;
  const unit = i === 1 ? 'PESO' : exactMillions ? 'DE PESOS' : 'PESOS';
  return `${words} ${unit} ${c}/100 M.N.`;
}
```

- [ ] **Step 4: Run** `npx jest src/maintenance/utils` → PASS.
- [ ] **Step 5: Commit** `feat(mtto): utils puras (km, semáforo, estados OC, totales, whatsapp, importe en letra)`

### Task 2: Migración 074 + entidades

**Files:**
- Create: `src/database/migrations/1786000000074-CreateMaintenanceModule.ts`
- Create: `src/entities/maintenance-service-category.entity.ts`, `maintenance-service.entity.ts`, `supplier.entity.ts`, `supplier-contact.entity.ts`, `maintenance-request.entity.ts`, `maintenance-quote.entity.ts`, `maintenance-quote-item.entity.ts`, `purchase-order.entity.ts`, `purchase-order-item.entity.ts`, `purchase-order-dispatch.entity.ts`, `maintenance-folio-counter.entity.ts`
- Modify: `src/entities/index.ts` (exports), `src/entities/vehicle.entity.ts` (+`lastMaintenanceKms`, `maintenanceIntervalKms`), `src/entities/company-settings.entity.ts` (+`maintenanceDeviationPct`), `src/common/enums/audit.enum.ts` (+`MANTENIMIENTO = 'mantenimiento'`).

**Interfaces (Produces):** entidades con los nombres de clase `MaintenanceServiceCategory`, `MaintenanceService`, `Supplier`, `SupplierContact`, `MaintenanceRequest`, `MaintenanceQuote`, `MaintenanceQuoteItem`, `PurchaseOrder`, `PurchaseOrderItem`, `PurchaseOrderDispatch`, `MaintenanceFolioCounter`; campos exactamente como el spec (sección Modelo de datos). Decimales con transformer `{ to: (v) => v, from: (v) => v === null ? null : Number(v) }` (exportado como `decimalTransformer` en `src/entities/maintenance-service.entity.ts`? → NO: crear `src/common/transformers/decimal.transformer.ts` si no existe; `grep -rn "DecimalTransformer\|decimalTransformer" src` primero y reutilizar si existe).

Enums de columna (tipo `enum` MySQL):
- request.status: `abierta,en_cotizacion,orden_generada,completada,cancelada`; priority: `baja,media,alta`.
- quote.status: `capturada,ganadora,descartada`.
- po.status: `PO_STATUSES`.
- contact.preferredChannel y dispatch.channel: `email,whatsapp`; dispatch.status: `enviado,error`.

- [ ] **Step 1:** Escribir entidades (patrón `vehicle.entity.ts`: `@PrimaryGeneratedColumn('uuid')`, `@ManyToOne` + `@Column` FK explícita, `createdAt` datetime default CURRENT_TIMESTAMP, `updatedAt` nullable, `@DeleteDateColumn({ type: 'datetime', nullable: true }) deletedAt` en service/supplier/request/quote/purchase_order). Relaciones `OneToMany` con `cascade: true` para items (quote→items, po→items), `supplier→contacts` (`cascade: true`).
- [ ] **Step 2:** Migración `up`: `CREATE TABLE IF NOT EXISTS` por tabla (utf8mb4_unicode_ci, InnoDB, FKs con índices), columnas nuevas con `columnExists`, semilla de 12 categorías (`INSERT IGNORE` con `UUID()`), filas de counter `('SM',0),('OC',0)`, backfill:
```sql
UPDATE vehicle v
JOIN (
  SELECT vehicleId, MAX(k) AS maxK FROM (
    SELECT pd.vehicleId, CAST(NULLIF(REGEXP_REPLACE(pd.kms, '[^0-9]', ''), '') AS UNSIGNED) AS k FROM package_dispatch pd WHERE pd.vehicleId IS NOT NULL
    UNION ALL
    SELECT pd.vehicleId, CAST(NULLIF(REGEXP_REPLACE(rc.actualKms, '[^0-9]', ''), '') AS UNSIGNED) FROM route_closure rc JOIN package_dispatch pd ON pd.id = rc.packageDispatchId WHERE pd.vehicleId IS NOT NULL
  ) x WHERE k IS NOT NULL AND k < 2000000 GROUP BY vehicleId
) m ON m.vehicleId = v.id
SET v.kms = GREATEST(COALESCE(v.kms, 0), m.maxK);
```
(Verificar antes nombres reales de columnas: `grep -n "JoinColumn" src/entities/package-dispatch.entity.ts src/entities/route-closure.entity.ts`.) `down`: drop tablas en orden inverso + columnas.
- [ ] **Step 3:** `npx tsc --noEmit` limpio.
- [ ] **Step 4:** Correr en local: `npm run typeorm migration:run` (o script existente en package.json: `grep -n migration package.json`). Verificar `SELECT COUNT(*) FROM maintenance_service_category` = 12.
- [ ] **Step 5: Commit** `feat(mtto): migración 074 y entidades del módulo de mantenimiento`

### Task 3: Permisos RBAC (075) + audit/notificaciones/directorio

**Files:**
- Modify: `src/auth/rbac/permission-catalog.ts` (tras línea 77):
```ts
  { code: 'mttoVehiculos.solicitudes', name: 'Solicitudes y cotizaciones Mtto.', groupName: 'Mtto. Vehículos', roles: ['admin', 'superadmin'] },
  { code: 'mttoVehiculos.ordenes', name: 'Órdenes de compra Mtto.', groupName: 'Mtto. Vehículos', roles: ['admin', 'superadmin'] },
  { code: 'mttoVehiculos.catalogos', name: 'Catálogos Mtto. (servicios, proveedores)', groupName: 'Mtto. Vehículos', roles: ['admin', 'superadmin'] },
  { code: 'mttoVehiculos.autorizar', name: 'Autorizar órdenes de compra', groupName: 'Mtto. Vehículos', roles: [] },
```
- Create: `src/database/migrations/1786000000075-SyncMaintenancePermissions.ts` — copia del cuerpo de la 066 (recorre catálogo) + al final:
```ts
const users: any[] = await q.query(
  "SELECT id FROM `user` WHERE LOWER(email) = 'edgardolugo@paqueteriaymensajeriadelyaqui.com' OR (LOWER(name) LIKE '%edgardo%' AND LOWER(COALESCE(lastName, name)) LIKE '%lugo%') LIMIT 1",
);
```
(verificar columnas de `user` con `grep -n "@Column" -A1 src/entities/user.entity.ts`), si hay usuario → `INSERT IGNORE INTO user_permission (id,userId,permissionId,effect) VALUES (UUID(),?,?, 'allow')`; si no → `console.warn('[075] No se encontró a Edgardo Lugo; asignar mttoVehiculos.autorizar desde Roles y Permisos')`. `down` borra los 4 códigos.
- Modify: `src/notifications/notification-catalog.ts`:
```ts
  // ---- Mantenimiento ----
  'mtto.oc_por_autorizar': { category: 'operacion', icon: 'gavel', severity: 'warning', channels: ['bell', 'email'] },
  'mtto.oc_autorizada':    { category: 'operacion', icon: 'check-circle', severity: 'info', channels: ['bell'] },
  'mtto.oc_rechazada':     { category: 'operacion', icon: 'x-circle', severity: 'warning', channels: ['bell'] },
```
- Modify: `src/support/module-directory.ts` — entradas para Programación, Historial, Solicitudes, Bandeja de cotizaciones, Órdenes de compra, Catálogos (seguir formato existente).
- Test: `npx jest src/notifications/notification-catalog.spec.ts src/auth` → PASS.
- [ ] Commit `feat(mtto): permisos RBAC (075), notificaciones y directorio de módulos`

### Task 4: Km vivo en salida a ruta y cierre

**Files:**
- Create: `src/maintenance/vehicle-kms.service.ts` (+ spec)
- Modify: `src/package-dispatch/package-dispatch.service.ts` (tras guardar `newDispatch`, fuera de la transacción o con el mismo manager), `src/routeclosure/routeclosure.service.ts` (`create`, tras guardar el cierre), módulos correspondientes (proveer `VehicleKmsService`; exportarlo desde un `MaintenanceKmsModule` liviano para no importar todo el módulo en package-dispatch → poner en `src/maintenance/vehicle-kms.module.ts` que importa `TypeOrmModule.forFeature([Vehicle])`).

**Interfaces:** `VehicleKmsService.bump(vehicleId: string | undefined | null, captured: unknown, source: 'dispatch' | 'closure'): Promise<void>` — nunca lanza (try/catch + `logger.warn`).

```ts
@Injectable()
export class VehicleKmsService {
  private readonly logger = new Logger(VehicleKmsService.name);
  constructor(@InjectRepository(Vehicle) private readonly repo: Repository<Vehicle>) {}
  async bump(vehicleId: string | undefined | null, captured: unknown, source: 'dispatch' | 'closure'): Promise<void> {
    if (!vehicleId) return;
    try {
      const v = await this.repo.findOne({ where: { id: vehicleId }, select: ['id', 'kms'] });
      if (!v) return;
      const r = nextVehicleKms(v.kms, captured);
      if (!r.changed) { if (r.reason === 'jump') this.logger.warn(`km ignorado (${source}) vehículo ${vehicleId}: ${v.kms} → ${captured}`); return; }
      await this.repo.update(vehicleId, { kms: r.kms! });
    } catch (e: any) { this.logger.warn(`no se pudo actualizar km (${source}) ${vehicleId}: ${e?.message}`); }
  }
}
```
Spec: mock repo; (a) captured mayor → `update` llamado con kms; (b) menor → no update; (c) repo lanza → no propaga.
Llamadas: package-dispatch → `await this.vehicleKms.bump(dto.vehicle?.id ?? (dto.vehicle as any), dto.kms, 'dispatch')` **después** del `commitTransaction`. routeclosure → obtener vehicleId del dispatch cargado (`dispatch.vehicle?.id`) y `bump(..., dto.actualKms, 'closure')` después de guardar.
- Test: `npx jest src/maintenance/vehicle-kms.service.spec.ts src/package-dispatch src/routeclosure` → PASS (ajustar mocks de specs existentes que construyen los servicios: agregar provider `{ provide: VehicleKmsService, useValue: { bump: jest.fn() } }`).
- [ ] Commit `feat(mtto): el km del vehículo se actualiza con salidas a ruta y cierres`

### Task 5: Folios + catálogo de categorías y servicios (API)

**Files:**
- Create: `src/maintenance/folio.service.ts` (+spec), `src/maintenance/catalog/catalog.service.ts`, `catalog.controller.ts`, `dto/category.dto.ts`, `dto/service.dto.ts`, `src/maintenance/maintenance.module.ts`
- Modify: `src/app.module.ts` (import `MaintenanceModule`)

**Interfaces:**
```ts
FolioService.next(manager: EntityManager, prefix: 'SM' | 'OC'): Promise<string> // 'OC-000001'
// SELECT lastValue FROM maintenance_folio_counter WHERE prefix=? FOR UPDATE; UPDATE +1
export const formatFolio = (prefix: string, n: number) => `${prefix}-${String(n).padStart(6, '0')}`;
```
Endpoints (controller `@Controller('maintenance/catalog')`, `@UseGuards(PermissionsGuard)`):
- `GET categories` (`@RequirePermission('mttoVehiculos.catalogos','mttoVehiculos.solicitudes','mttoVehiculos.ordenes')`) → activas y no activas ordenadas por sortOrder,name.
- `POST categories`, `PATCH categories/:id` (`catalogos`). DTO: `name` (IsString, MinLength 2), `sortOrder?` (IsInt), `active?` (IsBoolean). Nombre duplicado → 409.
- `GET services?categoryId&vehicleType&q&includeInactive` (lectura amplia como arriba) → con `category`.
- `POST services`, `PATCH services/:id`, `DELETE services/:id` (soft) (`catalogos`). DTO: `name`, `categoryId` (IsUUID), `unit` (IsIn servicio/pieza/litro/juego), `referencePrice` (IsNumber, Min 0), `vehicleType?` (IsEnum VehicleTypeEnum), `active?`.
Auditoría `auditService.log({ module: AuditModule.MANTENIMIENTO, action, entityName, entityId, userId })` en create/update/delete.
- Test: `folio.service.spec.ts` (manager mock: query devuelve `[{lastValue: 41}]` → `'OC-000042'` y se ejecuta UPDATE), `catalog.service.spec.ts` (duplicado → ConflictException; delete hace softDelete).
- [ ] Commit `feat(mtto): folios y API de catálogo (categorías y servicios)`

### Task 6: Proveedores + contactos (API)

**Files:** `src/maintenance/suppliers/suppliers.service.ts`, `suppliers.controller.ts`, `dto/supplier.dto.ts` (+spec)

Endpoints `@Controller('maintenance/suppliers')`: `GET` (q, includeInactive; lectura: catalogos|solicitudes|ordenes), `GET :id` (con contacts), `POST`, `PATCH :id`, `DELETE :id` (soft; catalogos).
DTO `SupplierDto { name; rfc?; address?; notes?; active?; contacts: ContactDto[] }`, `ContactDto { id?; name; position?; email?; phone?; whatsapp?; preferredChannel: 'email'|'whatsapp'; isDefault?: boolean }` con `@ValidateNested({ each: true }) @Type(() => ContactDto)`.
Reglas (función pura exportada `normalizeContacts(contacts)` testeada):
- Si ninguno `isDefault` → el primero lo es; si varios → solo el primero marcado queda.
- Contacto con `preferredChannel='email'` sin email, o `'whatsapp'` sin `toWhatsappNumber(whatsapp || phone)` → `BadRequestException('El contacto X no tiene <correo|WhatsApp> válido para su medio predeterminado')`.
PATCH reemplaza la lista de contactos (borra los que no vienen).
- [ ] Commit `feat(mtto): API de proveedores con contactos y medio predeterminado`

### Task 7: Programación (API) + vehículo

**Files:** `src/maintenance/schedule/schedule.service.ts`, `schedule.controller.ts` (+spec)

Endpoints `@Controller('maintenance/schedule')`:
- `GET subsidiary/:subsidiaryId` (`@UseGuards(PermissionsGuard, SubsidiaryScopeGuard)`, `programacion`) → `Array<{ vehicle: {id, code, name, plateNumber, brand, model, type, status, kms, lastMaintenanceDate, lastMaintenanceKms, maintenanceIntervalKms, nextMaintenanceDate}, status: MaintenanceStatusResult, openRequest: { id, folio, status } | null }>` ordenado vencido→proximo→sin_datos→al_dia, luego kmsRemaining asc.
- `PATCH vehicle/:vehicleId` (`programacion`) body `{ maintenanceIntervalKms?: number (Min 500); lastMaintenanceKms?: number; lastMaintenanceDate?: string; nextMaintenanceDate?: string | null }` → actualiza vehículo, audita.
Spec: orden correcto y `openRequest` = solicitud no completada/cancelada más reciente.
- [ ] Commit `feat(mtto): API de programación de mantenimiento`

### Task 8: Front base — tipos, servicios, hooks, menú, helper espejo

**Files (app-pmy):**
- Create: `lib/types/maintenance.ts` (tipos TS espejo de las entidades y respuestas), `lib/services/maintenance.ts` (axiosConfig; una función por endpoint), `hooks/services/maintenance/use-maintenance.ts` (hooks SWR: `useServiceCategories`, `useMaintenanceServices`, `useSuppliers`, `useSupplier(id)`, `useSchedule(subsidiaryId)`, y en fases siguientes `useRequests`, `useRequest`, `useQuoteInbox`, `usePurchaseOrders`, `usePurchaseOrder`, `usePendingAuthorizations`, `useHistory`), `lib/maintenance-status.ts` (copia literal del util BE sin imports Nest) + `lib/maintenance-status.test.ts` (mismos casos del Task 1).
- Modify: `lib/constants.ts` bloque "Mtto. Vehículos":
```ts
items: [
  { name: "Programación", url: "/programacion-mtto", icon: PenToolIcon, roles: allowedPageRoles.mttoVehiculos.programacion, isActive: false },
  { name: "Solicitudes", url: "/mtto/solicitudes", icon: ClipboardList, roles: allowedPageRoles.mttoVehiculos.solicitudes, isActive: false },
  { name: "Bandeja de cotizaciones", url: "/mtto/cotizaciones", icon: Scale, roles: allowedPageRoles.mttoVehiculos.solicitudes, isActive: false },
  { name: "Órdenes de compra", url: "/mtto/ordenes", icon: FileText, roles: allowedPageRoles.mttoVehiculos.ordenes, isActive: false },
  { name: "Historial", url: "/historial-mtto", icon: HistoryIcon, roles: allowedPageRoles.mttoVehiculos.historial, isActive: false },
  { name: "Catálogos", url: "/mtto/catalogos", icon: BookOpen, roles: allowedPageRoles.mttoVehiculos.catalogos, isActive: false },
]
```
- Modify: `lib/access/allowed-page-roles.ts` `mttoVehiculos` += `solicitudes`, `ordenes`, `catalogos` (ADMIN, SUPERADMIN), `autorizar: [UserRoleEnum.SUPERADMIN]`. **Importante:** `codeForRolesRef` mapea por identidad de array; cada entrada debe ser un array literal distinto (no reutilizar la misma referencia) — verificar cómo se construye `ROLES_REF_TO_CODE` en `lib/access/permissions.ts`.
- Test: `npx vitest run lib/maintenance-status.test.ts` → PASS; `npx tsc --noEmit`.
- [ ] Commit `feat(mtto): base front (tipos, servicios, hooks, menú, semáforo espejo)`

### Task 9: Página Catálogos

**Files:** `app/mtto/catalogos/page.tsx`, `components/maintenance/catalog/services-tab.tsx`, `categories-tab.tsx`, `suppliers-tab.tsx`, `service-form-dialog.tsx`, `category-form-dialog.tsx`, `supplier-form-dialog.tsx` (contactos editables en lista con radio "Predeterminado" y Select de medio).
- `withAuth(Page, "mttoVehiculos.catalogos")`, `OperationHeader` (icon `BookOpen`, "Catálogos de mantenimiento"), sin selector de sucursal (catálogos globales — excepción justificada: no dependen de sucursal).
- Tabs shadcn; cada tab un `DataTable` con columnas: Servicios (nombre, categoría, unidad, precio ref. `$` formateado, tipo de vehículo, activo, acciones editar/eliminar con `AlertDialog`); Categorías (nombre, orden, activa); Proveedores (nombre, RFC, contacto predeterminado, medio con icono Mail/MessageCircle, acciones).
- Forms con react-hook-form + zod si el repo ya los usa (`grep -rn "zodResolver" components | head -1`); si no, estado controlado.
- Verificación: levantar preview (`preview_start`), crear categoría/servicio/proveedor, screenshot.
- [ ] Commit `feat(mtto): pantalla de catálogos (servicios, categorías, proveedores)`

### Task 10: Página Programación

**Files:** `app/programacion-mtto/page.tsx`, `components/maintenance/schedule/schedule-kpis.tsx`, `schedule-columns.tsx`, `schedule-dialog.tsx`.
- `withAuth(Page, "mttoVehiculos.programacion")`, `OperationHeader` (icon `Wrench`, "Programación de mantenimiento", actions: `SucursalSelector`).
- KPIs (4 `Card`): Vencidos (rojo), Próximos (ámbar), Al día (verde), Sin datos (gris) — clic filtra la tabla (filtro `light`).
- DataTable: Unidad (code/name + placas), Km actual, Último mtto (fecha · km), Intervalo, Próximo (km · fecha), Faltan (km / días), Estado (`Badge` color por light, texto: "Vencido", "Próximo", "Al día", "Sin datos"), acciones: "Programar" (abre `schedule-dialog`: intervalo, último km, última fecha, próxima fecha) y "Nueva solicitud" (navega a `/mtto/solicitudes?nueva=1&vehicleId=…&subsidiaryId=…`; si ya hay `openRequest` muestra "Ver solicitud SM-…").
- Verificación en preview con sucursal real.
- [ ] Commit `feat(mtto): pantalla de programación con semáforo por km y fecha`

---

## FASE 2 — Solicitudes, cotizaciones, bandeja

### Task 11: API solicitudes + cotizaciones + adjunto + convertir

**Files:** `src/maintenance/requests/requests.service.ts`, `quotes.service.ts`, `requests.controller.ts`, `dto/request.dto.ts`, `dto/quote.dto.ts`, `quote-attachment.storage.ts` (+ specs)

Endpoints `@Controller('maintenance/requests')`, permiso `mttoVehiculos.solicitudes` (lectura también `ordenes`):
- `GET subsidiary/:subsidiaryId?status` (SubsidiaryScopeGuard) → lista con vehicle, quotesCount, minTotal, purchaseOrder {id, folio, status}.
- `GET inbox/:subsidiaryId` → solicitudes `en_cotizacion` con ≥1 cotización, con cotizaciones + items (para comparar).
- `GET :id` → solicitud + vehicle + quotes(items, supplier) + purchaseOrder.
- `POST` `{ vehicleId, kmsAtRequest?, description, priority }` → `subsidiaryId` = vehicle.subsidiary.id; folio SM en transacción; también `vehicleKms.bump(vehicleId, kmsAtRequest, 'dispatch')` (usar source `'request'`: ampliar union a `'dispatch'|'closure'|'request'|'completion'`).
- `PATCH :id` (description/priority/kms; solo si no tiene OC), `DELETE :id` (soft; solo si no tiene OC), `POST :id/cancel`.
- `POST :id/quotes` `{ supplierId, quoteDate, validUntil?, notes?, items: [{ serviceId?, description, quantity, unitPrice, taxRate? }] }` → por item: `referencePrice` = service.referencePrice (snapshot), `deviationPct`, `amount`; totales con `totals(items)`; request `abierta → en_cotizacion`.
- `PATCH quotes/:quoteId`, `DELETE quotes/:quoteId` (bloqueado si request tiene OC → 400 "La solicitud ya tiene orden de compra").
- `POST quotes/:quoteId/attachment` (`FileInterceptor('file')`, máx 10 MB, mime pdf/jpg/png/webp) → guarda en `STORAGE_ROOT/maintenance/quotes/<quoteId>/<nombre-saneado>` (reutilizar raíz de almacenamiento de EmailLog: ver `relDir/abs` en `email-log.service.ts`), `GET quotes/:quoteId/attachment` → stream.
- `POST quotes/:quoteId/convert` → en transacción: quote `ganadora`, hermanas `descartada`, crea PO `borrador` (folio OC, supplier, contacto `isDefault`, vehicle, subsidiary, items copiados con `approved=true`, totales), request `orden_generada`. Devuelve PO. Si ya existe PO para la request → 409.
Specs: crear cotización calcula desviación/totales y cambia estado; convertir crea PO con items copiados y marca hermanas; eliminar con OC → 400.
- [ ] Commit `feat(mtto): API de solicitudes, cotizaciones, adjuntos y conversión a orden`

### Task 12: Front — Solicitudes, detalle, captura de cotización, comparativo, bandeja

**Files:** `app/mtto/solicitudes/page.tsx`, detalle (ruta dinámica o `?id=` según verificación next export — Step 0: `grep -n "output" next.config.js`), `app/mtto/cotizaciones/page.tsx`, `components/maintenance/requests/request-form-dialog.tsx`, `request-columns.tsx`, `quote-form-dialog.tsx` (tabla editable de partidas: Combobox de servicio del catálogo filtrado por tipo de vehículo → autollenado de descripción y precio; badge ámbar "+X % sobre referencia" si `deviationPct > company.maintenanceDeviationPct`; totales en vivo con helper espejo `totals` en `lib/maintenance-money.ts`; input de archivo), `quote-comparison.tsx` (columnas por proveedor, filas por partida agrupadas por servicio/descripción, total, marca "más barata", botón "Elegir y crear orden" con `AlertDialog`).
- Solicitudes: `withAuth(..., "mttoVehiculos.solicitudes")`, `SucursalSelector`, DataTable (folio, unidad, descripción, prioridad, estado, cotizaciones, mejor total, orden), botón "Nueva solicitud" (Select de vehículo con `useVehiclesBySubsidiary`); soporta `?nueva=1&vehicleId=`.
- Detalle: datos, lista de cotizaciones (editar/eliminar/ver adjunto), "Agregar cotización", comparativo si ≥2.
- Bandeja: `SucursalSelector` + tarjetas por solicitud con `quote-comparison`; tras convertir → `router.push` al detalle de la orden.
- Verificación preview: flujo completo solicitud → 2 cotizaciones → convertir.
- [ ] Commit `feat(mtto): pantallas de solicitudes, cotizaciones y bandeja comparativa`

---

## FASE 3 — Órdenes, autorización, PDF, envío

### Task 13: API órdenes + autorización

**Files:** `src/maintenance/purchase-orders/purchase-orders.service.ts`, `purchase-orders.controller.ts`, `dto/*.ts`, `authorizer.util.ts` (+ specs)

```ts
// authorizer.util.ts
export const AUTHORIZE_CODE = 'mttoVehiculos.autorizar';
export function isAuthorizer(user: { role?: string; permissions?: string[] }): boolean {
  const role = (user?.role || '').toLowerCase();
  return role === 'superadmin' || role === 'superamin' || (user?.permissions ?? []).includes(AUTHORIZE_CODE);
}
```
Endpoints `@Controller('maintenance/purchase-orders')`:
- `GET subsidiary/:subsidiaryId?status` (ordenes|autorizar; autorizador sin scope de sucursal: si `isAuthorizer` saltar SubsidiaryScopeGuard → implementar scope manual en service en vez del guard).
- `GET pending` (`autorizar`) → todas las `pendiente` (bandeja de la barra).
- `GET :id` → PO + items + supplier(contacts) + contact + vehicle + subsidiary + request + quote + authorizedBy + dispatches.
- `PATCH :id` `{ notes?, contactId?, supplierId?, items?: [{ id?, serviceId?, description, quantity, unitPrice, taxRate?, approved? }] }` → `canEditItems(status, isAuthorizer(user))` o 403; recalcula totales (solo aprobadas).
- `POST :id/submit` → borrador→pendiente; notifica `mtto.oc_por_autorizar` a `{ userIds }` de usuarios con user_permission `mttoVehiculos.autorizar` (query join permission) — fallback `{ role: 'superadmin' }`; link `/mtto/ordenes/<id>` (o `?id=`).
- `POST :id/authorize` (`autorizar`) `{ items?: [{ id, approved, quantity?, unitPrice? }] }` → aplica cambios, exige ≥1 aprobada (400 "Aprueba al menos una partida"), pendiente→autorizada, `authorizedById/At`, notifica `mtto.oc_autorizada` al creador.
- `POST :id/reject` (`autorizar`) `{ reason }` (MinLength 3) → pendiente→rechazada→borrador (guardar `rejectionReason`), notifica creador.
- `POST :id/cancel` `{ reason, notifySupplier?: boolean }` → autorizada|enviada→cancelada; si estaba enviada y `notifySupplier` → `PoDispatchService.sendCancellation` (Task 14).
- `DELETE :id` → `canDelete` o 400; soft delete; request vuelve a `en_cotizacion` y quote ganadora a `capturada`.
- Auditoría STATUS_CHANGE en cada transición.
Specs: admin no puede authorize (403 vía guard → probar `isAuthorizer`), authorize sin aprobadas → 400, totales solo aprobadas tras authorize, reject regresa a borrador con motivo, delete en autorizada → 400.
- [ ] Commit `feat(mtto): API de órdenes de compra con autorización exclusiva`

### Task 14: PDF + envío (correo/WhatsApp) + reenvío

**Files:**
- Create: `src/documents/seeds/templates/purchase-order.pdf.html.ts`, `src/maintenance/dispatch/po-pdf.mapper.ts` (+spec), `po-dispatch.service.ts` (+spec), `po-dispatch.controller.ts` (o rutas en purchase-orders.controller)
- Modify: `src/documents/seeds/pdf-templates.seed.ts` (+ seed `purchase_order_pdf`, LETTER portrait, margins `'24px'`, variables listadas), `src/whatsapp-gateway/whatsapp-gateway.service.ts`, `src/mail/mail.service.ts`.
- Nota: `seedPdfTemplates` solo inserta si falta → se crea al arrancar (verificar que el bootstrap seeder corre en arranque: `templates-bootstrap.seeder.ts`).

```ts
// po-pdf.mapper.ts
export interface PoPdfData { folio; date; subsidiaryName; supplier: { name; rfc; address }; contact: { name; email; phone }; vehicle: { label; plates; brandModel; kms };
  rows: Array<{ index: number; quantity: string; description: string; unitPrice: string; amount: string }>;
  subtotal: string; tax: string; total: string; totalInWords: string; notes: string; authorizedBy: string; authorizedAt: string; requestFolio: string; }
export function mapPurchaseOrderToPdf(po: PurchaseOrder): PoPdfData; // SOLO items approved !== false; montos con Intl es-MX currency MXN
```
Spec: PO con 3 items (1 no aprobado) → `rows.length === 2`, total = solo aprobadas, `totalInWords` correcto.

Plantilla HTML (Handlebars): encabezado con `{{#if brand.logoLight}}<img src="{{brand.logoLight}}">{{/if}}`, `{{brand.fiscal.razonSocial}}`, RFC, dirección; caja derecha "ORDEN DE COMPRA" + folio + fecha; bloque 2 columnas Proveedor / Unidad; tabla `{{#each rows}}` (# · Cant. · Descripción · P. unitario · Importe) con cebra; totales alineados a la derecha; "Importe con letra: {{totalInWords}}"; notas/condiciones fijas ("Favor de hacer referencia a este folio en su factura. Precios incluyen IVA desglosado."); firma "Autorizó: {{authorizedBy}} — {{authorizedAt}}"; pie con `{{brand.contact.website}}` / teléfono. Paleta neutra institucional (azul marino `#1e3a5f` encabezados, gris `#f3f4f6` cebra), tipografía sans 10px.

```ts
// whatsapp-gateway.service.ts
/** Envía un documento (PDF u otro) desde buffer a un contacto/grupo. */
async sendDocument(to: string, buffer: Buffer, fileName: string, caption?: string, mimetype = 'application/pdf') {
  if (this.status !== 'connected' || !this.sock) throw new ServiceUnavailableException('WhatsApp no está conectado.');
  const jid = to.endsWith('@g.us') || to.endsWith('@s.whatsapp.net') ? to : `${String(to).replace(/\D/g, '')}@s.whatsapp.net`;
  await this.sock.sendMessage(jid, { document: buffer, fileName, mimetype, caption });
  return { ok: true, to: jid };
}
```
```ts
// mail.service.ts
async sendPurchaseOrderEmail(opts: { to: string; cc?: string | string[]; subject: string; html: string; pdf: { filename: string; content: Buffer } }): Promise<MailSendResult> {
  const info: any = await this.dispatch({ to: opts.to, cc: opts.cc, subject: opts.subject, html: opts.html, attachments: [opts.pdf] });
  return { to: opts.to, cc: this.recipientsToString(opts.cc), subject: opts.subject, accepted: this.infoAddresses(info?.accepted), rejected: this.infoAddresses(info?.rejected), messageId: info?.messageId };
}
```
`PoDispatchService`:
- `renderPdf(poId): Promise<{ buffer: Buffer; fileName: string }>` → `templateService.render('purchase_order_pdf', mapPurchaseOrderToPdf(po))`, fileName `OC-000123.pdf`.
- `send(poId, user, { channel?: 'email'|'whatsapp', contactId?, cc? })` → status debe ser `autorizada` o `enviada` (400 si no); destino según canal (email del contacto / `toWhatsappNumber(whatsapp || phone)`); si falta → 400 claro. Correo: HTML breve (saludo, folio, unidad, total, "Se adjunta la orden de compra autorizada"), cc = correo de la sucursal (`subsidiary.officeEmail`) si existe; `emailLog.persistAttachments('purchase_order', po.id, [pdf])` + `emailLog.record({ module: 'purchase_order', entityId: po.id, ... status })`. WhatsApp: `sendDocument(num, buffer, fileName, 'Orden de compra OC-… — <empresa>')`. Éxito → fila dispatch `enviado`, `assertTransition(status,'enviada')`, status `enviada`. Error → fila dispatch `error` con mensaje, status sin cambio, lanzar `BadRequestException('No se pudo enviar por <canal>: <msg>. Puedes intentar por el otro medio.')`.
- `sendCancellation(po, user)` → mismo canal del último envío exitoso, texto "La orden OC-… queda CANCELADA. Motivo: …" (email sin adjunto / WhatsApp `sendText`). Errores solo se registran.
Endpoints: `GET :id/pdf` (StreamableFile inline; permisos ordenes|autorizar) — el PDF de borrador lleva marca "BORRADOR — NO VÁLIDA" (flag `isDraft` en data → `{{#if isDraft}}` marca de agua), `POST :id/send`, `GET :id/dispatches`.
Specs: send sin autorizar → 400; email ok → dispatch enviado + status enviada + emailLog.record; whatsapp falla → dispatch error y status intacto; contacto sin whatsapp → 400.
- [ ] Commit `feat(mtto): PDF institucional de orden de compra y envío por correo/WhatsApp`

### Task 15: Front — Órdenes, detalle, autorización, envío, bandeja en barra

**Files:** `app/mtto/ordenes/page.tsx`, detalle, `components/maintenance/orders/order-columns.tsx`, `order-items-table.tsx` (modo lectura / edición borrador / modo autorizador con `Checkbox` "Aprobar" por partida y edición de cantidad/precio; totales en vivo solo aprobadas), `send-order-dialog.tsx` (RadioGroup canal con el predeterminado preseleccionado, muestra destino, opcional cambiar contacto), `reject-dialog.tsx`, `cancel-order-dialog.tsx` (motivo + switch "Avisar al proveedor" si enviada), `order-timeline.tsx` (creada, enviada a autorización, autorizada/rechazada, envíos con estatus y error), `components/maintenance/po-authorization-tray.tsx` (Popover con badge = `usePendingAuthorizations().count`, polling 30 s, lista folio/unidad/proveedor/total → link al detalle; solo render si `hasPermission(user,"mttoVehiculos.autorizar")`), `components/app-layout.tsx` (montar junto a `<ApprovalTray />`).
- Lista: `withAuth(..., "mttoVehiculos.ordenes")` — Tabs Borrador / Por autorizar / Autorizadas / Enviadas / Completadas / Canceladas con contador; DataTable (folio, fecha, unidad, proveedor, total, estado, autorizó).
- Detalle: header con folio + Badge estado; acciones por estado y permiso: Borrador → Editar, Enviar a autorización, Eliminar; Pendiente (autorizador) → Autorizar, Rechazar; Autorizada → Ver PDF, Enviar al proveedor, Cancelar; Enviada → Ver PDF, Reenviar, Completar (Task 17), Cancelar. "Ver PDF" abre `GET /pdf` en nueva pestaña con blob (axios `responseType: 'blob'`).
- Nota: la página de detalle debe ser accesible también con permiso `autorizar` (withAuth acepta un code; si no admite varios, usar `"mttoVehiculos.ordenes"` y dar a Edgardo también `ordenes` en la migración 075 vía user_permission — agregar a Task 3 si se confirma).
- Verificación preview: borrador → enviar a autorización → autorizar desmarcando 1 partida → PDF solo con aprobadas → enviar (correo a cuenta de prueba) → estado Enviada.
- [ ] Commit `feat(mtto): pantallas de órdenes de compra, autorización y bandeja en la barra`

---

## FASE 4 — Completar, gasto, Historial

### Task 16: API completar + historial

**Files:** `purchase-orders.service.ts` (`complete`), `src/maintenance/schedule/history.service.ts` (+ specs), rutas en controllers.
- `POST purchase-orders/:id/complete` (`ordenes`) `{ completedAt: 'YYYY-MM-DD', completedKms: number, finalAmount?: number, nextMaintenanceDate?: string | null }` → enviada→completada en transacción: vehicle `lastMaintenanceDate = completedAt 07:00Z`, `lastMaintenanceKms = completedKms`, `kms` vía `nextVehicleKms` (si cambia), `nextMaintenanceDate` si viene; request `completada`; Expense `{ subsidiaryId, categoryId: <'Mantenimiento'>, vehicleId, date: completedAt, amount: finalAmount ?? po.total, description: 'Mantenimiento <unidad> — OC-… (<proveedor>)', responsible: user name, notes: 'Generado desde orden de compra' , createdById }`; `po.expenseId`. Categoría: `findOne({ where: { name: 'Mantenimiento' } })`, si no existe crear `{ name: 'Mantenimiento', active: true }`.
- `GET history/subsidiary/:subsidiaryId?from&to&vehicleId` (`historial`) → `{ rows: Array<{ poId, folio, completedAt, completedKms, vehicle, supplierName, services: string[], amount }>, byVehicle: Array<{ vehicle, count, total, lastMaintenanceDate, lastMaintenanceKms }>, legacy: Array<{ vehicle, lastMaintenanceDate }> }` — `legacy` = vehículos de la sucursal con `lastMaintenanceDate` y sin OCs completadas (datos previos).
Specs: complete actualiza vehículo, crea gasto con monto final, marca request; complete desde autorizada → 400; historial agrupa por vehículo.
- [ ] Commit `feat(mtto): completar orden (vehículo + gasto) e historial por vehículo`

### Task 17: Front — Completar + Historial

**Files:** `components/maintenance/orders/complete-order-dialog.tsx` (fecha, km con mínimo = km actual del vehículo y aviso si es menor, monto final prellenado con total, próxima fecha opcional sugerida = +90 días), `app/historial-mtto/page.tsx`, `components/maintenance/history/history-columns.tsx`.
- Historial: `withAuth(..., "mttoVehiculos.historial")`, `SucursalSelector`, rango de fechas (reutilizar componente de rango existente: `grep -rln "DateRangePicker\|date-range" components | head`), filtro por unidad; KPIs (servicios en el periodo, gasto total, unidad con más gasto); Tabs "Servicios" (DataTable de rows) y "Por unidad" (DataTable byVehicle + legacy con Badge "Registro previo").
- Verificación preview: completar orden enviada → aparece en Historial, Programación en "Al día", gasto visible en Gastos.
- [ ] Commit `feat(mtto): completar orden desde la UI y pantalla de historial`

### Task 18: Cierre

- [ ] `npx jest` (pmy-api) completo y `npx vitest run` (app-pmy): todo verde; `npx tsc --noEmit` en ambos; lint de archivos tocados.
- [ ] `graphify update .` en ambos repos.
- [ ] Actualizar memoria (proyecto: módulo mtto, migraciones 074/075 pendientes en prod).
- [ ] Commit final y resumen al usuario (pendiente: correr 074/075 en prod, vincular WhatsApp, confirmar usuario de Edgardo).

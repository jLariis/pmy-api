# Compras v4: servicios predefinidos, "Lo que se necesita" y 4 sugerencias — Plan de implementación

> **Para quien ejecute:** SUB-SKILL: superpowers:executing-plans (inline, elegido por el usuario). Pasos con casillas `- [ ]`.

**Objetivo:** Solicitudes simples (unidad + servicios + texto), catálogo de servicios con receta opcional, y en la cotización una lista de necesidades con 4 sugerencias de producto/proveedor por pieza/insumo que arman la cotización con un clic.

**Arquitectura:** Funciones puras en backend (`needs.util`, `rank-offers.util`) probadas con Jest; un `NeedsService` persiste necesidades en `request_need` y arma cotizaciones con `pick`. El front consume `GET /requests/:id/needs` y muestra la tarjeta "Lo que se necesita". Spec: `docs/superpowers/specs/2026-09-24-compras-necesidades-sugerencias-design.md`.

**Tech:** NestJS 10 + TypeORM/MySQL + Jest (pmy-api); Next.js export estático + SWR + shadcn/Tailwind + Vitest (app-pmy).

## Restricciones globales

- Todo texto visible al usuario en español llano; validación campo por campo.
- Solo shadcn (`@/components/ui/*`) + Tailwind; pantallas dentro de AppLayout + withAuth + OperationHeader.
- Acciones fuertes en el OperationHeader; en el cuerpo solo contenido/filtros.
- Migraciones idempotentes, sin COLLATE explícito, `DB_SYNC=false`.
- Commits con rutas explícitas (nunca `git add .`), en la rama actual (`main`), trabajo inline.
- Al terminar cambios de código: `graphify update .` en cada repo.
- Smoke contra BD real SIN `NestFactory.create(AppModule)` completo (choca con WhatsApp): usar DataSource + servicios instanciados a mano; limpiar datos, folios y precios.

---

### Task 1: Esquema v4 (migración 083 + entidades + semilla)

**Files:**
- Create: `src/database/migrations/1786000000083-ComprasV4ServicesNeeds.ts`
- Create: `src/entities/service-template.entity.ts`, `src/entities/service-template-item.entity.ts`, `src/entities/request-service.entity.ts`, `src/entities/request-need.entity.ts`
- Modify: `src/entities/product-category.entity.ts` (+`keywords`), `src/entities/maintenance-quote.entity.ts` (+`fromCatalog`), `src/entities/maintenance-quote-item.entity.ts` (+`requestNeedId`), `src/entities/maintenance-request.entity.ts` (+`services` OneToMany cascade), `src/entities/index.ts`, `src/maintenance/maintenance.module.ts` (forFeature)
- Create: `src/database/seeds/compras-services.seed.ts`

**Interfaces (produce):**
- `ServiceTemplate { id; name; description|null; vehicleType|null; keywords|null; active; items: ServiceTemplateItem[]; createdAt; updatedAt|null }`
- `ServiceTemplateItem { id; serviceTemplateId; categoryId; category; quantity:number; unitId|null; unit; sortOrder }`
- `RequestService { id; requestId; serviceTemplateId; serviceTemplate; sortOrder }`
- `NEED_SOURCES = ['receta','ficha','palabra','manual']`; `RequestNeed { id; requestId; categoryId; category; productId|null; product; quantity; unitId|null; unit; source; sourceLabel; dismissed; sortOrder; createdAt }`
- `SEED_SERVICES: {name; keywords}[]`, `SEED_CATEGORY_KEYWORDS: Record<string /*nombre categoría*/, string /*sinónimos*/>`

- [ ] **Step 1:** Crear entidades (patrón de `vehicle-spec-item.entity.ts`: uuid, `createForeignKeyConstraints:false`, `decimalTransformer` en cantidades).
- [ ] **Step 2:** Semilla:

```ts
export const SEED_SERVICES = [
  { name: 'Servicio preventivo', keywords: 'servicio, preventivo, mantenimiento, cambio de aceite' },
  { name: 'Reparación general', keywords: 'reparacion, falla, descompuesta, no enciende' },
  { name: 'Revisión de frenos', keywords: 'frenos, frenar, rechina, balatas, truena al frenar' },
  { name: 'Afinación', keywords: 'afinacion, bujias, jalonea, tironea' },
];
export const SEED_CATEGORY_KEYWORDS: Record<string, string> = {
  'BALATAS': 'frenos, frenar, rechina, balata', 'DISCO DE FRENO': 'frenos, disco, vibra al frenar',
  'LIQUIDO DE FRENOS': 'frenos, liquido de frenos', 'ACEITE': 'aceite, cambio de aceite, lubricante',
  'FILTRO DE ACEITE': 'filtro, aceite', 'FILTRO DE AIRE': 'filtro, aire', 'LLANTA': 'llanta, llantas, ponchada, neumatico',
  'AMORTIGUADOR': 'suspension, amortiguador, rebota', 'BUJIA': 'bujia, bujias, afinacion',
};
```
Se aplica por coincidencia normalizada (sin acentos, mayúsculas) contra `product_category.name`; las que no existan se ignoran.
- [ ] **Step 3:** Migración 083: `CREATE TABLE IF NOT EXISTS` para las 4 tablas (índices por `requestId`, `serviceTemplateId`); `ALTER` condicional (information_schema) para `product_category.keywords text NULL`, `maintenance_quote.fromCatalog tinyint NOT NULL DEFAULT 0`, `maintenance_quote_item.requestNeedId varchar(36) NULL`; insertar servicios semilla si no existe el nombre; `UPDATE product_category SET keywords=? WHERE keywords IS NULL AND name normalizado = ?`. `down`: drop tablas y columnas.
- [ ] **Step 4:** `npx tsc --noEmit` limpio; `npm run migration:run` → "executed successfully".
- [ ] **Step 5:** Commit: `feat(compras): esquema v4 - servicios predefinidos con receta, necesidades por solicitud, sinonimos (mig 083)`.

### Task 2: Motor de necesidades (`needs.util`) — TDD

**Files:** Create `src/maintenance/utils/needs.util.ts`, Test `src/maintenance/utils/needs.util.spec.ts`

**Interfaces (produce):**
```ts
export const normalize: (s: string) => string;
export interface KeywordEntry { id: string; name: string; keywords?: string | null }
export function matchKeywords(text: string, entries: KeywordEntry[]): Array<{ id: string; matched: string }>;
export type NeedSource = 'receta' | 'ficha' | 'palabra' | 'manual';
export interface NeedDraft { categoryId: string; productId: string | null; quantity: number; unitId: string | null; source: NeedSource; sourceLabel: string }
export interface RecipeService { id: string; name: string; keywords?: string | null; items: Array<{ categoryId: string; quantity: number; unitId: string | null }> }
export interface SpecEntry { categoryId: string; productId: string | null; quantity: number; unitId: string | null }
export function buildNeeds(input: { chosen: RecipeService[]; text: string; serviceCatalog: RecipeService[]; categories: KeywordEntry[]; spec: SpecEntry[] }): NeedDraft[];
```

- [ ] **Step 1: pruebas que fallan**

```ts
import { buildNeeds, matchKeywords, normalize } from './needs.util';

describe('normalize', () => {
  it('quita acentos, mayúsculas y signos', () => expect(normalize('¡Truena al FRENAR, líquido!')).toBe('truena al frenar liquido'));
});

describe('matchKeywords', () => {
  const cats = [
    { id: 'bal', name: 'BALATAS', keywords: 'frenos, rechina' },
    { id: 'liq', name: 'LIQUIDO DE FRENOS', keywords: 'liquido de frenos' },
    { id: 'fre', name: 'FRENTE', keywords: null },
  ];
  it('raíces parecidas coinciden; palabras distintas no', () => {
    expect(matchKeywords('truena al frenar', cats)).toEqual([{ id: 'bal', matched: 'frenar' }]);
    expect(matchKeywords('cambiar la balata', cats).map((m) => m.id)).toEqual(['bal']);
  });
  it('sinónimo de varias palabras requiere todas', () => {
    expect(matchKeywords('le falta liquido de frenos', cats).map((m) => m.id).sort()).toEqual(['bal', 'liq']);
    expect(matchKeywords('liquido del radiador', cats)).toEqual([]);
  });
});

describe('buildNeeds', () => {
  const s10k = { id: 's10', name: 'Servicio de 10,000 km', keywords: 'servicio', items: [
    { categoryId: 'ace', quantity: 5, unitId: 'L' }, { categoryId: 'fac', quantity: 1, unitId: null }] };
  const frenos = { id: 'sfr', name: 'Revisión de frenos', keywords: 'frenar, rechina', items: [{ categoryId: 'bal', quantity: 1, unitId: 'J' }] };
  const categories = [{ id: 'ace', name: 'ACEITE' }, { id: 'fac', name: 'FILTRO DE ACEITE' }, { id: 'bal', name: 'BALATAS', keywords: 'frenos' }, { id: 'amo', name: 'AMORTIGUADOR', keywords: 'rebota' }];
  it('receta + palabras, sin duplicados; la ficha manda producto/cantidad', () => {
    const out = buildNeeds({
      chosen: [s10k], text: 'rechina al frenar y rebota', serviceCatalog: [s10k, frenos], categories,
      spec: [{ categoryId: 'ace', productId: 'mobil', quantity: 6, unitId: 'L' }],
    });
    expect(out.map((n) => [n.categoryId, n.source, n.quantity, n.productId])).toEqual([
      ['ace', 'receta', 6, 'mobil'], ['fac', 'receta', 1, null], ['bal', 'palabra', 1, null], ['amo', 'palabra', 1, null],
    ]);
    expect(out[0].sourceLabel).toBe('Del servicio "Servicio de 10,000 km"');
    expect(out[2].sourceLabel).toBe('Por lo que escribió: "frenar"');
  });
  it('sin servicios ni coincidencias: vacío', () => {
    expect(buildNeeds({ chosen: [], text: 'hola', serviceCatalog: [], categories, spec: [] })).toEqual([]);
  });
});
```
- [ ] **Step 2:** `npx jest src/maintenance/utils/needs.util` → FALLA (módulo no existe).
- [ ] **Step 3: implementación**

```ts
const STOP = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'para', 'y', 'a', 'al', 'en', 'con']);
export const normalize = (s: string) =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ñ\s]/g, ' ').replace(/\s+/g, ' ').trim();
const words = (s: string) => normalize(s).split(' ').filter((w) => w && !STOP.has(w));
const commonPrefix = (a: string, b: string) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };
/** Iguales, o prefijo común ≥4 y ≥ (más corta − 2): frenar~frenos, balata~balatas, freno≁frente. */
export const similar = (a: string, b: string) => {
  if (a === b) return true;
  const p = commonPrefix(a, b);
  return p >= 4 && p >= Math.min(a.length, b.length) - 2;
};
export function matchKeywords(text: string, entries: KeywordEntry[]) {
  const tokens = words(text);
  const out: Array<{ id: string; matched: string }> = [];
  for (const e of entries) {
    const phrases = [e.name, ...(e.keywords ?? '').split(',')].map((p) => words(p)).filter((p) => p.length);
    for (const ph of phrases) {
      const hits = ph.map((w) => tokens.find((t) => similar(t, w)));
      if (hits.every(Boolean)) { out.push({ id: e.id, matched: hits[0]! }); break; }
    }
  }
  return out;
}
export function buildNeeds({ chosen, text, serviceCatalog, categories, spec }: {...}): NeedDraft[] {
  const map = new Map<string, NeedDraft>();
  const add = (d: NeedDraft) => { if (!map.has(d.categoryId)) map.set(d.categoryId, d); };
  const fromRecipe = (s: RecipeService, source: NeedSource, label: string) =>
    s.items.forEach((i) => add({ categoryId: i.categoryId, productId: null, quantity: Number(i.quantity), unitId: i.unitId, source, sourceLabel: label }));
  for (const s of chosen) fromRecipe(s, 'receta', `Del servicio "${s.name}"`);
  if (normalize(text)) {
    const chosenIds = new Set(chosen.map((s) => s.id));
    for (const m of matchKeywords(text, serviceCatalog.filter((s) => !chosenIds.has(s.id) && s.items.length))) {
      fromRecipe(serviceCatalog.find((s) => s.id === m.id)!, 'palabra', `Por lo que escribió: "${m.matched}"`);
    }
    for (const m of matchKeywords(text, categories)) add({ categoryId: m.id, productId: null, quantity: 1, unitId: null, source: 'palabra', sourceLabel: `Por lo que escribió: "${m.matched}"` });
  }
  for (const n of map.values()) {
    const f = spec.find((x) => x.categoryId === n.categoryId);
    if (f) Object.assign(n, { productId: f.productId, quantity: Number(f.quantity), unitId: f.unitId ?? n.unitId });
  }
  return [...map.values()];
}
```
Nota: "rechina al frenar" coincide con el servicio "Revisión de frenos" por su sinónimo "frenar" (el nombre completo no, falta "revision"), así que balatas entra por receta de ese servicio con origen palabra y etiqueta "frenar".
- [ ] **Step 4:** Jest pasa.
- [ ] **Step 5:** Commit `feat(compras): motor de necesidades (receta + ficha + palabras clave)`.

### Task 3: Ranking de ofertas (`rank-offers.util`) — TDD

**Files:** Create `src/maintenance/utils/rank-offers.util.ts`, Test `...spec.ts`

**Interfaces (produce):**
```ts
export type OfferLabel = 'mas_comprado' | 'mejor_precio' | 'mejor_calidad' | 'mejor_relacion';
export interface OfferCandidate { offerId: string; productId: string; productName: string; brand: string | null; supplierId: string; supplierName: string; unitName: string | null; price: number; quality: number | null; purchases: number }
export interface RankedOffer extends OfferCandidate { labels: OfferLabel[] }
export function rankOffers(c: OfferCandidate[], opts?: { preferredProductId?: string | null }): RankedOffer[];
```

- [ ] **Step 1: pruebas**

```ts
const c = (id: string, price: number, quality: number | null, purchases = 0, productId = id) =>
  ({ offerId: id, productId, productName: id, brand: null, supplierId: 's' + id, supplierName: 'S' + id, unitName: null, price, quality, purchases });
it('cada etiqueta a su ganador, en orden fijo', () => {
  const out = rankOffers([c('a', 180, 4, 7), c('b', 150, 3), c('c', 260, 5), c('d', 155, 4)]);
  expect(out.map((o) => [o.offerId, o.labels])).toEqual([
    ['a', ['mas_comprado']], ['b', ['mejor_precio']], ['c', ['mejor_calidad']], ['d', ['mejor_relacion']],
  ]);
});
it('una oferta puede ganar varias etiquetas (sale una vez)', () => {
  const out = rankOffers([c('a', 100, 5, 3), c('b', 120, 2)]);
  expect(out).toHaveLength(1);
  expect(out[0].labels).toEqual(['mas_comprado', 'mejor_precio', 'mejor_calidad', 'mejor_relacion']);
});
it('sin compras no hay "más comprado"; sin estrellas cuenta como 3; empate → preferido', () => {
  const out = rankOffers([c('x', 100, null), c('y', 100, null, 0, 'pref')], { preferredProductId: 'pref' });
  expect(out[0].offerId).toBe('y');
  expect(out.flatMap((o) => o.labels)).not.toContain('mas_comprado');
});
it('sin candidatos → []', () => expect(rankOffers([])).toEqual([]));
```
Cálculo esperado: relación a=4/(180/150)=3.33, b=3/1=3, c=5/(260/150)=2.88, d=4/(155/150)=3.87 → d; calidad → c (5★); precio → b; más comprado → a.
- [ ] **Step 2:** falla. **Step 3:** implementar: `best(cmp)` = primer elemento tras ordenar con `cmp` y desempates (`preferido` primero, luego precio, luego `offerId`); relación `(q ?? 3) / (price / minPrice)` con `minPrice = min(price>0)`; acumular etiquetas en un `Map<offerId, RankedOffer>` en orden `mas_comprado, mejor_precio, mejor_calidad, mejor_relacion` (omitir `mas_comprado` si el máximo de compras es 0; omitir `mejor_calidad` si nadie tiene estrellas). **Step 4:** pasa. **Step 5:** commit `feat(compras): ranking de 4 sugerencias por pieza/insumo`.

### Task 4: Catálogo de servicios + sinónimos (backend)

**Files:** Create `src/maintenance/catalog/service-templates.service.ts`, `service-templates.controller.ts` (o rutas en `products.controller.ts`), `dto/service-templates.dto.ts`, spec del servicio; Modify `src/maintenance/catalog/products.service.ts` + `dto/products.dto.ts` (categoría acepta `keywords`), `maintenance.module.ts`.

**Interfaces:** `GET maintenance/catalog/service-templates?includeInactive` (autenticados) → `ServiceTemplate[]` con `items.category`, `items.unit`; `POST`/`PATCH :id` (catalogos|revisar) body `{name, description?, vehicleType?, keywords?, active?, items:[{categoryId, quantity, unitId?}]}`; `DELETE :id` (baja lógica `active=false` si está usada en `request_service`, si no borra). Nombre único (mensaje "Ya existe un servicio con ese nombre"). Items: categoría debe ser `pieza|insumo`.

- [ ] Spec: crea con receta; rechaza nombre repetido; reemplaza items al editar; rechaza categoría de tipo servicio/equipo.
- [ ] Implementar (patrón `ProductsService.save` con reemplazo de hijos en transacción).
- [ ] `ProductCategory` DTO + service guardan `keywords` (trim, máx 500).
- [ ] tsc + jest; commit `feat(compras): catalogo de servicios predefinidos con receta y sinonimos`.

### Task 5: Solicitud v4 (servicios elegidos, renglones opcionales)

**Files:** Modify `src/maintenance/requests/dto/request.dto.ts`, `requests.service.ts` (+spec), `requests.controller.ts` (sin cambios de rutas).

- DTO: `serviceTemplateIds?: string[]` (`IsUUID each`, mensaje "Servicio no reconocido"); `items` pasa a `@IsOptional()` con `@ArrayMinSize(0)`.
- Servicio `create/update`: si el tipo requiere unidad → requiere unidad; válido con servicios o descripción (≥3). Si es `compra` → `items.length ≥ 1` ("Agrega al menos un renglón: qué se necesita y cuánto"). Guarda `request_service` (reemplazo en update). `findOne` agrega `services: [{id, name}]` (join `services.serviceTemplate`).
- Al editar la solicitud (antes de cotizar) se borran `request_need` no manuales para que se regeneren.
- [ ] Spec: mantenimiento sin renglones y con servicios → OK; compra sin renglones → error; guarda servicios.
- [ ] tsc + jest; commit `feat(compras): solicitud v4 con servicios predefinidos y sin piezas obligatorias`.

### Task 6: NeedsService (necesidades, sugerencias y elegir)

**Files:** Create `src/maintenance/requests/needs.service.ts` (+spec); Modify `requests.controller.ts`, `quotes.service.ts` (update apaga `fromCatalog`, conserva `requestNeedId`), `dto/request.dto.ts` (`QuoteItemDto.requestNeedId?`), `utils/comparison.util.ts` (+spec) y `comparison.service.ts` (filas = renglones + necesidades no descartadas; match `requestNeedId`), `maintenance.module.ts`.

**Interfaces (produce):**
```ts
interface NeedView { id: string; category: {id; name; kind}; product: {id; name; brand} | null; quantity: number; unit: {id; name; abbreviation} | null;
  source: NeedSource; sourceLabel: string; suggestions: RankedOffer[]; inQuote: { quoteId: string; supplierName: string; quoteItemId: string } | null }
NeedsService.list(requestId, user): Promise<{ needs: NeedView[] }>   // genera si no hay (y la solicitud no es compra sin texto)
NeedsService.add(requestId, {categoryId, quantity, unitId?}, user)
NeedsService.dismiss(needId, user)
NeedsService.recalculate(requestId, user)
NeedsService.pick(needId, offerId, user): Promise<{ quoteId: string }>
```
Rutas: `GET :id/needs`, `POST :id/needs`, `POST :id/needs/recalculate`, `DELETE needs/:needId`, `POST needs/:needId/pick` — todas `@RequirePermission(MTTO.revisar)` (no chocan con `:id`: distinto número de segmentos).

Candidatos: `product_offer` join `product` (activo, `categoryId = need.categoryId`) join `supplier` (activo) + `unit`; `purchases` = `SELECT poi.productId, po.supplierId, COUNT(*) FROM purchase_order_item poi JOIN purchase_order po ON po.id=poi.purchaseOrderId WHERE po.status IN ('enviada','completada') AND po.deletedAt IS NULL GROUP BY 1,2`.

`pick`: `loadQuotable` (reutilizar; hacerlo público en QuotesService como `assertQuotable`). Busca cotización del proveedor de la oferta en la solicitud; si no hay, crea `MaintenanceQuote{fromCatalog:true, quoteDate: hoy HMO, notes:'Armada desde el catálogo: confirma precio y existencia con el proveedor', status:'capturada'}`; quita partidas con ese `requestNeedId` de otras cotizaciones (y recalcula sus totales; si queda vacía y `fromCatalog`, se borra); agrega partida `{requestNeedId, productId, description: product.name + brand, quantity: need.quantity, unitPrice: offer.price, quality: offer.quality, availability:'si', ivaEnabled:true}`; recalcula totales con `totals()`; solicitud `abierta→en_cotizacion`; limpia `selectedQuoteItemId` afectados.

- [ ] Spec (mocks estilo `quotes.service.spec.ts`): list genera una vez; pick crea cotización nueva; pick mueve de otra cotización; pick con órdenes → BadRequest; dismiss oculta.
- [ ] comparison.util spec: una partida con `requestNeedId` cae en la fila de su necesidad.
- [ ] tsc + jest completos (`npx jest src/maintenance`).
- [ ] Commit `feat(compras): lo que se necesita con 4 sugerencias y armar cotizacion con un clic`.

### Task 7: Smoke backend contra BD real

- [ ] Script temporal `src/maintenance/__smoke.ts` con `DataSource` de `src/config/typeorm` (o el data-source de migraciones) e instanciar `NeedsService` con repos reales y dependencias mínimas (sin AppModule). Flujo: crear solicitud mantenimiento con servicio "Revisión de frenos" + texto "rechina al frenar" → `list` (ver necesidades y sugerencias) → `pick` de una oferta → comprobar cotización `fromCatalog` → comparativo. En `finally`: borrar todo, folios SOL a 0, restaurar `product_offer`.
- [ ] Borrar el script; commit si hubo arreglos.

### Task 8: Front — buscador en selects + ficha de unidad

**Files:** Create `app-pmy/components/maintenance/shared/searchable-select.tsx`; Modify `components/maintenance/schedule/vehicle-spec-dialog.tsx`.

```tsx
export interface SearchOption { value: string; label: string; hint?: string; group?: string }
export function SearchableSelect(props: { value: string | null; onChange: (v: string | null) => void; options: SearchOption[];
  placeholder?: string; searchPlaceholder?: string; emptyText?: string; allowClear?: boolean; clearLabel?: string; invalid?: boolean; className?: string })
export function SearchableMultiSelect(props: { values: string[]; onChange: (v: string[]) => void; options: SearchOption[]; placeholder?: string; ... })
```
Popover (`modal`) + Command con grupos; botón trigger con `invalidClass`; multi muestra chips (Badge) con quitar.
- [ ] Ficha: pieza/insumo (grupos Piezas/Insumos), producto preferido (con "Cualquiera"), presentación → `SearchableSelect`; Notas en una segunda fila de la tabla (`<TableRow>` con `colSpan` completo) o layout de tarjeta por renglón con Notas ancho completo.
- [ ] `npx tsc --noEmit` (filtrar a archivos de Compras/Mantenimiento) limpio.
- [ ] Commit `fix(compras): buscadores en la ficha de la unidad y notas con espacio`.

### Task 9: Front — menús separados, Servicios predefinidos, sinónimos

**Files:** Modify `lib/constants.ts` (menú Compras: Mis solicitudes, Tablero de compras, Catálogos; menú nuevo **Mantenimiento** con icono Wrench: Unidades `/programacion-mtto`, Historial `/historial-mtto`, Servicios `/mantenimiento/servicios` — roles con `allowedPageRoles.mttoVehiculos.*`); Create `app/mantenimiento/servicios/page.tsx`, `components/maintenance/catalog/service-template-dialog.tsx`; Modify `lib/types/compras.ts` (`ServiceTemplate`, `ProductCategory.keywords`), `lib/services/maintenance.ts` (`getServiceTemplates/saveServiceTemplate/deleteServiceTemplate`), `hooks/.../use-maintenance.ts` (`useServiceTemplates`), `components/maintenance/catalog/kind-catalog-tab.tsx` (campo Sinónimos).
- Página: AppLayout + withAuth(catalogos) + OperationHeader con "Nuevo servicio" en el header; DataTable (nombre, receta resumida "3 piezas/insumos", sinónimos, activo, acciones).
- Diálogo: nombre, descripción, tipo de unidad (opcional), sinónimos (input de chips: Enter/coma agrega), receta (filas con `SearchableSelect` de pieza/insumo + cantidad + presentación). Validación en llano.
- [ ] tsc limpio; commit `feat(mantenimiento): menu propio y catalogo de servicios predefinidos con receta y sinonimos`.

### Task 10: Front — nueva solicitud v4

**Files:** Modify `components/maintenance/requests/request-form-dialog.tsx`, `lib/services/maintenance.ts` (`RequestPayload.serviceTemplateIds`), `lib/types/maintenance.ts` (`MaintenanceRequest.services`), `components/maintenance/expediente/request-items-card.tsx` (muestra servicios + texto + renglones si existen), programación de unidades: botón "Solicitar servicio" → `/compras/solicitudes?nueva=1&vehicleId=…&subsidiaryId=…` (ya soportado).
- Tipos con unidad: unidad (SearchableSelect), servicios (`SearchableMultiSelect` desde `useServiceTemplates`, filtrando por `vehicleType` si aplica), "¿Qué necesita o qué le pasa?" (Textarea, obligatorio si no hay servicios), prioridad, km. Sin renglones.
- Compra: descripción + renglones de texto libre (descripción, cantidad, presentación opcional).
- Validación: con unidad → unidad + (servicio o texto ≥3); compra → ≥1 renglón.
- [ ] Vitest para helper de validación nuevo `validateRequest` en `lib/maintenance-validation.ts`.
- [ ] tsc limpio; commit `feat(compras): nueva solicitud con servicios predefinidos (sin piezas)`.

### Task 11: Front — tarjeta "Lo que se necesita"

**Files:** Create `components/maintenance/expediente/needs-card.tsx`; Modify `lib/types/maintenance.ts` (`NeedView`, `RankedOffer`, `OFFER_LABEL`), `lib/services/maintenance.ts` (`getNeeds/addNeed/dismissNeed/recalculateNeeds/pickNeedOffer`), hooks (`useNeeds`), `app/compras/solicitud/page.tsx` (tarjeta encima de cotizaciones, visible para Compras cuando no está por revisar/rechazada y no hay órdenes; solo lectura si hay órdenes), `quotes-step.tsx` (aviso ámbar en cotizaciones `fromCatalog`), `quote-form-dialog.tsx` (conserva `requestNeedId` al editar; muestra "Necesidad" en vez de "Renglón"; toast "Se actualizó el precio de X con Proveedor a $Y" cuando cambió respecto al catálogo).
- Por necesidad: encabezado (nombre, cantidad + presentación, origen como Badge, botón quitar); fila de hasta 4 tarjetas (producto, marca, proveedor, precio/presentación, `StarRating`, etiquetas: "Más comprado", "Mejor precio", "Mejor calidad", "Mejor calidad-precio"; botón "Elegir" o "✔ En cotización de X"). Sin sugerencias: texto llano + enlace a Catálogos.
- Acciones de contenido: "Agregar necesidad" (SearchableSelect de pieza/insumo + cantidad), "Recalcular".
- Tras `pick`: `mutate` necesidades + solicitud + comparativo.
- [ ] tsc limpio + Vitest; commit `feat(compras): tarjeta lo que se necesita con 4 sugerencias por pieza/insumo`.

### Task 12: Cierre

- [ ] `npx jest src/maintenance` y `npx tsc --noEmit` (pmy-api); Vitest de lib + tsc filtrado (app-pmy).
- [ ] Verificación en navegador (si el usuario inicia sesión): ficha con buscadores, nueva solicitud, servicios, tarjeta de necesidades → elegir → comparativo.
- [ ] `graphify update .` en ambos repos; actualizar memoria `mtto-vehiculos-modulo.md` (v4, mig 083 pendiente en prod).

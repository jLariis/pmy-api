# Consolidador v2 — vista por ruta/consolidado + análisis inteligente

**Fecha:** 2026-09-17
**Autor:** Javier Laris (con Claude)
**Repos:** `pmy-api` (BE) + `app-pmy` (FE)
**Estado:** Diseño aprobado — pendiente de plan de implementación

## Contexto

El Consolidador de Finanzas concilia ingresos por sucursal y semana. Hoy la
vista principal es una **tabla plana de filas de ingreso** con dos pestañas
(*Ingresos* / *Auditoría de cobros*), más dos diálogos sueltos (*Buscar paquete*
y *Anomalías*). Problemas que resuelve este rediseño:

1. **Buscar paquete** no ofrece acción cuando la guía no existe en el sistema.
2. El análisis de *"entregado por FedEx"* es ingenuo: `deliveredByFedex()` solo
   mira si el estatus es `ENTREGADO_POR_FEDEX`, sin cruzar consolidado, ruta ni
   fecha del ingreso. Marca como sospechosos cobros que en realidad son válidos
   (los entregamos nosotros el día de la ruta).
3. El diseño de *Buscar paquete* es pobre.
4. La organización por filas de ingreso no deja ver la operación real: el usuario
   quiere ver **los consolidados/rutas de la semana** y dentro de cada uno los
   entregados/no entregados/ingresos y las anomalías/errores evaluados ahí mismo.

## Objetivos

- Reorganizar la vista en **4 pestañas**: *Por ruta*, *Por consolidado*,
  *Buscar paquete*, *Auditoría de cobros*.
- Cada ruta/consolidado se muestra como **tarjeta plegable** con KPIs y, al
  expandir, el detalle de guías con estatus, ingreso y **veredicto**.
- Un **motor de veredicto** que cruza estatus FedEx + consolidado + ruta
  (`routeDate`) + fecha del ingreso y produce un veredicto con evidencia y una
  acción sugerida de 1 clic.
- Botones de alta/verificación cuando una guía buscada no existe.
- Rediseño visual coherente de todo el consolidador (skill `frontend-design`).

## No-objetivos (YAGNI)

- No se crea el registro de `shipment` desde el consolidador (el alta de envíos
  nace del pegar-FedEx / consolidado). Solo se da de alta **ingreso manual**.
- No se enlaza ni se abre la herramienta de pegar-FedEx desde aquí.
- No hay migraciones ni columnas nuevas: todo se deriva de datos existentes.
- No se auto-corrige nada sin confirmación del usuario (el fix es de 1 clic con
  motivo y auditoría, como hoy).

## Decisiones de diseño (confirmadas con el usuario)

| Tema | Decisión |
|------|----------|
| Agrupación de la vista semana | **Ambas**: sub-vistas *Por ruta* y *Por consolidado* |
| Detalle por guía | **Plegable in-place** dentro de la tarjeta |
| KPIs por tarjeta | Entregados/No entregados · Ingresos $ · Descuadre $ · # Anomalías |
| Definición de "entregado" | **Toda entrega** (`ENTREGADO`, `ENTREGADO_EN_BODEGA`, `ENTREGADO_POR_FEDEX`) |
| Veredicto #2 al concluir "lo entregamos nosotros" | Veredicto + evidencia + **fix de 1 clic** |
| Tolerancia de fecha ruta↔ingreso | **Mismo día exacto** |
| Guía inexistente en Buscar paquete | **Alta de ingreso manual** (precargando tracking+sucursal) + **verificar contra FedEx** |
| Guía existente con error | Acciones actuales, **mejor presentadas** |
| Alcance del rediseño | **Todo el consolidador**, coherente |
| Ubicación de Buscar paquete | **Pestaña propia** (deja de ser modal) |

## Motor de veredicto (`logic/package-verdict.util.ts`)

Función pura y testeable. Entrada:

```ts
interface VerdictInput {
  currentStatus: ShipmentStatusType | null;
  history: Array<{ status: string | null; timestamp: Date | string | null }>;
  hasConsolidado: boolean;
  /** routeDate de la salida a ruta a la que pertenece el shipment (día de negocio). */
  routeDate: Date | string | null;
  /** fecha del ingreso activo ligado (si existe). */
  incomeDate: Date | string | null;
}

type VerdictLevel = 'ok' | 'warn' | 'danger';
type SuggestedAction =
  | { kind: 'none' }
  | { kind: 'fix_status'; to: ShipmentStatusType }   // p.ej. ENTREGADO
  | { kind: 'delete_income' };

interface Verdict {
  code:
    | 'delivered_by_us'          // entregado por fedex PERO salió en nuestra ruta el día del ingreso
    | 'fedex_delivery_doubtful'  // entregado por fedex, sin ruta ese día → cobro dudoso
    | 'our_delivery_ok'          // entrega nuestra normal, respaldada
    | 'no_income_ok'             // sin ingreso, sin problema
    | 'date_mismatch'            // ingreso fechado en día sin evento
    | 'income_without_support'   // cobro sin evento terminal que lo respalde
    | 'status_regressed';        // tuvo estatus final y volvió a tránsito
  level: VerdictLevel;
  title: string;                 // texto corto para la columna Veredicto
  evidence: string[];            // líneas de evidencia legibles
  suggestedAction: SuggestedAction;
}
```

Reglas (en orden de prioridad; `dayKey` = `toISOString().slice(0,10)`):

1. **delivered_by_us** — `ENTREGADO_POR_FEDEX` (actual o histórico) **y**
   `routeDate` existe **y** `incomeDate` existe **y**
   `dayKey(routeDate) === dayKey(incomeDate)`.
   → `level: 'ok'`, evidencia (consolidado, ruta del día, ingreso del mismo
   día), `suggestedAction: fix_status → ENTREGADO`. El cobro **es válido**.
2. **fedex_delivery_doubtful** — `ENTREGADO_POR_FEDEX` con ingreso y **sin** ruta
   ese día (o sin ruta). → `level: 'danger'`, `suggestedAction: delete_income`.
3. **date_mismatch / income_without_support / status_regressed** — se conservan
   las reglas de `detectAnomalies` actuales, expresadas como veredictos.
4. **our_delivery_ok / no_income_ok** — casos sanos (`level: 'ok'`).

`detect-anomalies.util.ts` se refactoriza para delegar en el motor de veredicto
(o el motor lo reemplaza y `getWeekAnomalies` pasa a mapear veredictos con
`level !== 'ok'`). Se conserva compatibilidad de los campos que consume el FE.

## Backend (`src/consolidador/`)

### Lectura agrupada — `read/consolidador-groups.service.ts`

Dos métodos que barren la semana de la sucursal (mismos límites de fecha que
`getWeek`) y agrupan:

- `getByRoute(subsidiaryId, from, to)` → agrupa por `shipment.routeId`
  (`PackageDispatch`). Trae `routeDate`, conductor(es), # guías.
- `getByConsolidado(subsidiaryId, from, to)` → agrupa por `consNumber`
  (`consolidated.consNumber` para envíos, `charge.consNumber` para cargas).

Cada grupo devuelve:

```ts
interface ConsolidadorGroup {
  id: string;                 // routeId o consNumber
  label: string;              // "Ruta …8c2a1f · 17 sep" / "Consolidado 3391"
  date: string | null;        // routeDate / fecha del consolidado (día)
  meta: { driver?: string; owner?: string; shipmentCount: number };
  kpis: {
    delivered: number;
    notDelivered: number;
    incomeAmount: number;
    incomeCount: number;
    chargeDiscrepancy: number;   // reusa cobros-audit acotado al grupo
    anomalyCount: number;
  };
  rows: GroupRow[];           // guías con estatus, ingreso y veredicto
}

interface GroupRow {
  tracking: string;
  shipmentId: string | null;
  status: ShipmentStatusType | null;
  income: { id: string; cost: number } | null;
  verdict: Verdict;
}
```

Notas:
- **delivered** = estatus en `{ENTREGADO, ENTREGADO_EN_BODEGA, ENTREGADO_POR_FEDEX}`;
  **notDelivered** = el resto (DEX/rechazo/tránsito).
- `chargeDiscrepancy` reutiliza `CobrosAuditService` acotando el resultado a las
  guías del grupo (sin duplicar la regla).
- El veredicto se calcula con `routeDate` (del `PackageDispatch` del grupo) y la
  `incomeDate` del ingreso ligado.

### Buscar paquete — extensión de `status/consolidador-status.service.ts`

- `search` / `searchBatch` cargan además `PackageDispatch.routeDate` y
  `consolidated` del shipment, y devuelven `verdict: Verdict` por guía
  (reemplaza/enriquece el `anomalies[]` actual; el FE migra a `verdict`).
- Cuando `shipment == null`: el resultado ya incluye `fedex` (el resolver corre
  para todas las guías). El FE usará eso para el botón *Ver en FedEx* y el botón
  *Dar de alta ingreso*.

### Endpoints (`consolidador.controller.ts`)

```
GET  :subsidiaryId/:fromDate/:toDate/by-route          → groups.getByRoute
GET  :subsidiaryId/:fromDate/:toDate/by-consolidado    → groups.getByConsolidado
```

Se declaran **antes** del comodín `:subsidiaryId/:fromDate/:toDate` (que va al
final por el shadowing de rutas de 3 segmentos, ver comentario existente).
El resto de endpoints (fix-status, repair-income, delete, create manual) se
reutilizan tal cual para las acciones de 1 clic.

## Frontend (`app-pmy`)

### Página — `app/finanzas/consolidador/page.tsx`
Header (sucursal + semana) + `Tabs` con 4 valores:
`por-ruta` · `por-consolidado` · `buscar` · `auditoria`.

### Componentes nuevos
- `components/consolidador/group-card.tsx` — tarjeta plegable con KPIs y, al
  expandir, la tabla de guías (estatus/ingreso/veredicto/acciones).
- `components/consolidador/verdict-badge.tsx` — pinta el veredicto por `level`
  (ok=emerald, warn=amber, danger=rose) con tooltip de evidencia y, si hay
  `suggestedAction`, el botón de 1 clic (con motivo).
- `components/consolidador/groups-view.tsx` — lista de `GroupCard` para una
  agrupación (recibe la data de by-route o by-consolidado).
- `components/consolidador/search-package-view.tsx` — reemplaza el diálogo por
  una sección; conserva la búsqueda por lote y agrega, para guías inexistentes,
  *Dar de alta ingreso* (abre `AddIncomeDialog` precargado) y *Ver en FedEx*.
- Hooks: `use-consolidador-groups.ts` (SWR para by-route/by-consolidado).

### Reglas de la casa
- Todo dentro de `AppLayout` + `withAuth("finanzas.consolidador")` + `OperationHeader`.
- Solo shadcn (`@/components/ui/*`) + Tailwind; nada de HTML crudo.
- Rediseño con `frontend-design` aplicado de forma coherente a las 4 pestañas.
- `AddIncomeDialog` gana props opcionales `defaultTracking`/`defaultKind` para
  precargar desde Buscar paquete.

## Manejo de errores

- Acciones de 1 clic reutilizan los endpoints existentes (verificación contra
  FedEx en `fixStatus`, guard de duplicado en repair/create) y su manejo de
  toasts. Requieren **motivo** (como hoy).
- Grupos sin ruta/consolidado (envíos sueltos) caen en un grupo *"Sin ruta"* /
  *"Sin consolidado"* para no perderlos.
- FedEx sin datos: el veredicto degrada a `warn` "sin verificar" en vez de
  concluir entrega propia.

## Pruebas

- **BE unit** `logic/package-verdict.util.spec.ts`: mismo día (delivered_by_us),
  sin ruta (fedex_delivery_doubtful), entrega propia normal, date_mismatch,
  income_without_support, status_regressed, FedEx sin datos.
- **BE unit** de agrupación (delivered/notDelivered counts, grupo "Sin ruta").
- **FE unit** helpers de mapeo de veredicto → badge/acción.
- Se corren `tsc` + lint + tests de los archivos tocados en ambos repos y se
  dejan sin errores (regla de la casa: arreglar todos los errores del archivo
  tocado).

## Rollout

- Rama nueva `feat/consolidador-v2` en ambos repos.
- Sin migraciones. Feature puramente aditiva sobre el módulo consolidador.
- `graphify update .` tras los cambios de BE.

# Dashboard Ejecutivo: conteos de paquetes desde consolidados

**Fecha:** 2026-08-29
**Repos:** `pmy-api` (backend). Sin cambios en `app-pmy` (el contrato del front se conserva).
**Estado:** diseño aprobado (Opción A).

## 1. Problema

El "Dashboard Ejecutivo" (`app/dashboard/page.tsx`, ruta protegida `withAuth(..., "dashboard")`)
y la pantalla de **Consolidados** (`app/operaciones/consolidados`) reportan conteos de
paquetes que **no cuadran** entre sí. La causa no es un bug puntual sino que hoy conviven
**tres motores de conteo distintos**, nunca diseñados para coincidir:

1. `Consolidated.numberOfPackages` — número **declarado** al crear el consolidado (la "verdad" del negocio).
2. `shipmentCounts.total` (pantalla Consolidados) — `COUNT` real de `shipment` + `charge_shipment`
   ligados por `consolidatedId`, con `active=true` y `status != cancelado`
   (`consolidated.service.ts` `findAll`).
3. `totalPackages` (Dashboard) — `COUNT(shipment.id)` por `createdAt` **+ backlog vivo**, sin join a
   consolidado, sin filtro `active`/`cancelado`; **más** `SUM(charge.numberOfPackages)` por `chargeDate`
   (`kpi.service.ts` `getSubsidiariesKpis`).

Ejes de divergencia del #3 contra #1/#2: fecha de anclaje distinta (`createdAt`/`chargeDate` vs
`consolidated.date`), backlog, guías sin consolidado, cargas contadas por tabla/criterio distinto,
y ausencia de filtros `active`/`cancelado`.

## 2. Decisión

**El Dashboard Ejecutivo se re-ancla 100% a los consolidados.** No se "compara": se cambia el número.

- `totalPackages` del dashboard = **`SUM(Consolidated.numberOfPackages)`** de los consolidados cuya
  `date` cae en el periodo filtrado desde el dashboard.
- Entregados, DEX, en ruta y demás conteos de estatus se derivan de las guías (`shipment` +
  `charge_shipment`) **ligadas por `consolidatedId`** a esos consolidados.
- Fuente única de verdad: se **reutiliza** el motor existente `ConsolidatedService.findAll`, de modo
  que el dashboard entregue **exactamente los mismos números** que la pantalla de Consolidados.

### Decisiones confirmadas con el usuario

- **Total = declarado; desglose informativo.** `totalPackages` = declarado (`SUM(numberOfPackages)`).
  El desglose (entregado/DEX/en ruta/…) sale de filas reales y **puede no sumar el total**; la brecha
  es "faltante por escanear". `averageEfficiency = deliveredPackages / totalPackages` (entregado ÷ declarado).
- **Guías sin `consolidatedId` se ignoran.** El dashboard queda 100% anclado a consolidados; recolecciones,
  altas directas e imports sin consolidar no aparecen en ningún conteo. (`shipment.consolidatedId` es nullable.)
- **Lo financiero se deja igual.** `totalRevenue`, `totalExpenses`, `totalProfit` y `generalSummary`
  siguen calculándose como hoy (tabla `Income` + `charge_rule` para ingresos; prorrateo para gastos).
  Solo cambian los conteos de paquetes.

## 3. Alcance

- **Backend:** solo `src/dashboard/kpi.service.ts` (`getSubsidiariesKpis`) y una adición menor
  (flag opcional) en `src/consolidated/consolidated.service.ts`.
- **Frontend:** **ninguno.** El contrato `SubsidiaryMetrics` (`components/subsidiary/subsidiary-metrics.tsx`)
  se conserva idéntico; la UI y el controller (`dashboard.controller.ts`, scoping por rol + blindaje de
  ingresos) no se tocan.

## 4. Arquitectura

`getSubsidiariesKpis(startDate, endDate, subsidiaryIds?)` pasa a:

1. **Conteos de paquetes (NUEVO):** llamar `ConsolidatedService.findAll({ subsidiaryIds }, fromDate, toDate)`
   y **agrupar por `subsidiary.id`**. `findAll` ya devuelve, por consolidado, `numberOfPackages`,
   `subsidiary {id,name}`, `type`, y `shipmentCounts` con el desglose de estatus.
2. **Financieros (SIN CAMBIO):** conservar las agregaciones actuales de `Income` (D) y `Expense` (C),
   con su ventana de fechas Hermosillo actual y su lógica `charge_rule`/prorrateo.
3. **Merge:** combinar ambos por `subsidiary.id` y devolver el mismo shape que hoy, incluido
   `generalSummary` (que sigue derivándose de los financieros).

`KpiService` ya está en `DashboardModule`; se le inyecta `ConsolidatedService`
(exportado por `ConsolidatedModule`; agregar el import/export si falta, evitando ciclos —
`ConsolidatedService` no depende de `KpiService`).

### Reutilización de fechas (paridad exacta)

El dashboard convierte `startDate`/`endDate` (`YYYY-MM-DD`) a `Date` con `new Date(str)` y los pasa a
`findAll`, **igual que hace el controller de Consolidados** (`new Date(fromDate)`), que internamente
normaliza a la ventana UTC `[00:00:00, 23:59:59]` sobre los componentes UTC. Así los conteos del
dashboard usan la **misma ventana** que la pantalla de Consolidados y empatan al 100%.
(Los financieros mantienen su ventana Hermosillo; es un concern separado que se deja igual.)

### Optimización menor en `findAll`

`findAll` construye además dos consultas de listas de pendientes (`pendingShipments`) que el dashboard
no necesita. Se añade un parámetro opcional `options?: { summaryOnly?: boolean }` que, cuando es `true`,
**omite** esas dos consultas y deja `pendingShipments: []`. Comportamiento por defecto sin cambios
(la pantalla Consolidados sigue recibiendo sus pendientes). El dashboard llama con `summaryOnly: true`.

## 5. Mapeo de campos (rollup de `findAll` por sucursal)

Para cada sucursal, sumando sobre sus consolidados del periodo:

| Campo `SubsidiaryMetrics` | Cálculo |
|---|---|
| `totalPackages` | `Σ numberOfPackages` (**declarado**) |
| `deliveredPackages` | `Σ shipmentCounts.entregado` |
| `undeliveredPackages` | `Σ shipmentCounts.totalDex` (dex03+dex07+dex08) |
| `undeliveredDetails.byExceptionCode.code07` | `Σ shipmentCounts.dex07` |
| `undeliveredDetails.byExceptionCode.code08` | `Σ shipmentCounts.dex08` |
| `undeliveredDetails.byExceptionCode.code03` | `Σ shipmentCounts.dex03` |
| `undeliveredDetails.byExceptionCode.unknown` | `Σ shipmentCounts.otros` |
| `undeliveredDetails.total` | = `undeliveredPackages` |
| `inTransitPackages` | `Σ shipmentCounts.en_ruta` |
| `totalCharges` | `Σ shipmentCounts.countF2` (charge_shipment ligados) |
| `consolidations.ordinary` | count de consolidados con `type='ordinario'` |
| `consolidations.air` | count de consolidados con `type='aereo'` |
| `consolidations.total` | count de **todos** los consolidados de la sucursal (incl. `carga`) |
| `averageEfficiency` | `totalPackages>0 ? deliveredPackages/totalPackages*100 : 0` |
| `averageRevenuePerPackage` | `totalPackages>0 ? totalRevenue/totalPackages : 0` |
| `totalRevenue` / `totalExpenses` / `totalProfit` | **sin cambio** (financieros actuales) |
| `generalSummary` | **sin cambio** (suma de financieros) |

Sucursales del scope **sin** consolidados en el periodo aparecen con conteos en 0 pero conservan sus
financieros (se sigue iterando sobre el listado base de sucursales, no sobre los consolidados).

## 6. Errores y bordes

- **Sin consolidados en el rango:** conteos en 0; financieros intactos; `averageEfficiency=0`.
- **`numberOfPackages` nulo/0 en un consolidado:** cuenta 0 en el total (sin romper divisiones).
- **DHL:** cada pieza es una fila (`dhlUniqueId`); el desglose las cuenta por pieza (ver
  identidad de pieza DHL). El `numberOfPackages` declarado debe reflejar piezas.
- **Orden de sucursales:** se conserva el `sort` por `averageEfficiency` actual.

## 7. Pruebas

Unit (jest, backend) sobre el rollup:

1. Dos consolidados de la misma sucursal → `totalPackages` = suma de sus `numberOfPackages`; desglose
   suma entregado/dex/en_ruta.
2. Sucursal en el scope sin consolidados → conteos en 0, financieros presentes.
3. DHL: varias piezas con la misma guía maestra pero distinto `dhlUniqueId` cuentan por pieza.
4. `averageEfficiency` usa el denominador **declarado** (entregado/`SUM(numberOfPackages)`).
5. **Paridad:** el rollup del dashboard para un scope/rango == suma directa de `findAll` para el
   mismo scope/rango (mismos totales de entregado/dex/en_ruta y de `numberOfPackages`).
6. `summaryOnly: true` en `findAll` no altera los conteos (solo omite `pendingShipments`).

Regla del proyecto: dejar `tsc` y lint limpios en los archivos tocados.

## 8. No-objetivos / YAGNI

- No se re-anclan los ingresos a consolidados.
- No se crea un cubo "Sin consolidar" ni consolidado virtual para guías huérfanas.
- No se cambia la UI del dashboard ni el contrato `SubsidiaryMetrics`.
- No se unifica la ventana de fechas de financieros con la de conteos.

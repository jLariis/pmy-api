# Consolidador de Finanzas — Diseño

Fecha: 2026-09-09
Estado: aprobado (pendiente de plan de implementación)
Repos: `pmy-api` (backend) + `app-pmy` (frontend)

## 1. Problema

El módulo actual de Finanzas es de **solo lectura**:

- `pmy-api` → `src/income` expone únicamente `GET` (agregación por sucursal y rango).
- `app-pmy` → `app/ingresos/page.tsx` es un panel de reportes (KPIs + gráfica + tabla), sin capacidad de edición.

Operaciones no tiene una herramienta para **conciliar el dinero real** contra lo que el sistema registró. Casos que hoy se resuelven a mano o no se resuelven:

- Una carga quedó sin el **2º a bordo** (o con un costo mal calculado) y hay que corregir el ingreso.
- Faltan ingresos de **recolecciones**, **PODs** (entregados) o **DEX** (3ª visita) que no se generaron por el flujo automático.
- Un paquete tiene **estatus interno equivocado** respecto a FedEx, lo que arrastra un ingreso mal clasificado.

## 2. Objetivo

Un **consolidador** operable dentro de Finanzas que, **por sucursal y por semana (lunes–domingo)**, permita:

1. Ver los ingresos de **todos los tipos** (`shipment`, `collection`, `charge`, `manual`, `tyco`, `aeropuerto`, `special_transfer`).
2. **Editar costos de cargas** in-place: bajar el costo, quitar o poner el 2º a bordo.
3. **Dar de alta ingresos manualmente**: recolección, POD/entregado, DEX/3ª visita, manual.
4. **Buscar un paquete**, verificar su estatus contra **FedEx** y **corregir el estatus** (esto sí escribe `shipment`) ajustando el ingreso ligado.
5. Filtrar por **consolidado** y **ruta**, emparejados a la semana seleccionada.

**Regla de oro:** todas las ediciones modifican **solo `income`**, salvo la corrección de estatus, que modifica **`shipment`** (y de rebote ajusta el `income` ligado).

## 3. Decisiones tomadas (en brainstorming)

- **Edición in-place** sobre la fila `income` (no filas de reversa). Se conserva una miga de auditoría mínima.
- **FedEx**: se reusa `FedexStatusResolver` (read-only) para **leer** el último estatus canónico; la corrección de `shipment.status` + ajuste de `income` la aplica el consolidador con lógica **acotada** propia (no se acopla a `tracking-sync`).
- **Acceso directo** con un permiso nuevo `finanzas.consolidador` (superadmin/finanzas). Sin bandeja de aprobación. Cada cambio guarda quién/cuándo/motivo.
- Enfoque **A**: módulo backend nuevo + página frontend nueva. Se deja intacto `income` (solo lectura) y la pantalla `ingresos` (reportes).
- Construcción en **4 fases** dentro de este spec (ver §9).

## 4. Modelo de datos — 1 migración

Esquema **siempre por migración** (`DB_SYNC=false` en todos los entornos, incl. dev). Última migración en repo: `1786000000064-AddIncomeAnnulment`, así que la nueva es **`1786000000065-AddIncomeConsolidadorAudit`**.

Columnas nuevas en la tabla `income`:

| Columna         | Tipo                     | Nota |
|-----------------|--------------------------|------|
| `originalCost`  | `decimal(10,2)` null     | Snapshot del `cost` **antes** del primer ajuste in-place. Null = nunca editado. Permite mostrar "antes → ahora". |
| `updatedById`   | `char(36)` null          | Usuario que hizo el último ajuste. |
| `updatedAt`     | `datetime` null          | Momento del último ajuste. |
| `editReason`    | `varchar(255)` null      | Motivo del último ajuste (obligatorio en la request). |

No se crean tablas nuevas. No hay filas de reversa. `active`/`annulledAt`/`reversalOfIncomeId` (mig 064) siguen usándose solo por el flujo de devoluciones existente; el consolidador **no** los toca en v1.

## 5. Backend — módulo nuevo `src/consolidador/`

Estructura (unidades chicas, una responsabilidad c/u):

```
src/consolidador/
  consolidador.module.ts
  consolidador.controller.ts
  read/consolidador-read.service.ts        # agregación + filtros (lectura)
  income/consolidador-income.service.ts    # cost edit, 2º a bordo, alta manual
  status/consolidador-status.service.ts    # búsqueda + compare FedEx + aplicar
  logic/                                    # funciones PURAS testeables
    second-abord.util.ts
    manual-income.util.ts
    status-correction.util.ts
  dto/
```

Guard: el permiso `finanzas.consolidador` (registrar en el sistema de permisos del BE y en `app-pmy/lib/access/permissions.ts` + `allowed-page-roles.ts`).

### 5.1 Endpoints

Todos bajo `/consolidador`. Los write estampan `updatedById`/`updatedAt`/`editReason` (o `createdById` en alta).

| Método | Ruta | Propósito |
|--------|------|-----------|
| `GET`  | `/:subsidiaryId/:fromDate/:toDate` (query `consNumber?`, `routeId?`) | Filas de income de la semana + totales por bucket. |
| `PATCH`| `/income/:id/cost` | Nuevo costo in-place (body: `cost`, `reason`). Setea `originalCost` si es el 1er ajuste. |
| `PATCH`| `/income/:id/second-abord` | Quita/pone `subsidiary.secondAbordAmount` sobre `cost` (body: `enabled`, `reason`). |
| `POST` | `/income` | Alta manual (body: `subsidiaryId`, `kind`, `trackingNumber?`, `cost`, `date`, `reason`). |
| `GET`  | `/package/:tracking` | Shipment(s) + estatus interno vs FedEx canónico (resolver) + income ligado. |
| `PATCH`| `/package/:shipmentId/status` | Escribe `shipment.status` (+ ajusta income ligado) (body: `newStatus`, `reason`). |

`kind` de alta manual mapea a `(sourceType, incomeType)`:

- `recoleccion` → `sourceType=collection`, `incomeType` según captura.
- `pod` → `sourceType=shipment` (o `manual` si no hay shipment), `incomeType=entregado`.
- `dex` → `incomeType=cliente_no_disponible_3ra_visita`.
- `manual` → `sourceType=manual`.

### 5.2 Reglas de agregación (read)

- Ventana semanal **lunes–domingo** (misma regla que `lib/week` en FE y `pagination.util` en BE — ver memoria `week-range-lun-dom`).
- El income de `charge` se fecha con `charge.date` (medianoche local); el resto respeta el manejo de zona existente (`toLocalInstant`/offset por sourceType, ver `income.service`). El consolidador reusa ese criterio para no repetir el bug de "cargas del primer día".
- Filtro **consolidado**: por `consNumber` (join `income.charge.consNumber` y, para shipments, la relación a consolidado del shipment).
- Filtro **ruta**: join `income.shipment` → `package_dispatch` (usar `routeDate`/`routeId`, ver memoria `route-date-is315-novan-income`).
- Buckets de totales: `envios`, `cargas`, `recolecciones`, `traslados` (tyco+aeropuerto+special_transfer), `manual`.

### 5.3 Funciones puras (Jest)

- `computeSecondAbordDelta(income, subsidiary, enabled)` → nuevo `cost` (suma/resta `secondAbordAmount`, idempotente: no dobla ni baja de 0).
- `resolveManualIncomeCost(kind, subsidiary, overrides)` → `{ cost, sourceType, incomeType }`.
- `deriveStatusCorrection(currentStatus, fedexCanonicalStatus, income)` → `{ newStatus, incomeEffect }` donde `incomeEffect` ∈ `{ none, reclassify(incomeType), setCost(n), deactivate }`. Regla acotada y explícita; sin efectos si FedEx no difiere.

## 6. Frontend — `app/finanzas/consolidador/page.tsx`

Reglas de la casa (memoria `app-pmy-ui-house-rules`): **toda** la pantalla dentro de `AppLayout` + `withAuth("finanzas.consolidador")` + `OperationHeader`, construida **solo** con `@/components/ui/*` (shadcn) + Tailwind. Nada de HTML crudo suelto.

### 6.1 Layout

- **OperationHeader**: título "Consolidador de Finanzas", icono (`SlidersHorizontal`/`Wallet`), acción "Exportar" (reusar `exportIncomesToExcel` si el shape encaja).
- **Barra de filtros** (Card): `SucursalSelector` + selector de semana lun–dom (vía `lib/week` `getWeekRange`, con navegación ‹ semana ›) + `Popover` **Consolidado** (lista de `consNumber` de la semana) + `Popover` **Ruta** (lista de rutas de la semana). Los filtros consolidado/ruta **acotan** las filas ya limitadas a la semana.
- **KPIs**: `Card` por bucket (Envíos, Cargas, Recolecciones, Traslados, Manual) + Total, con importe y conteo.
- **Tabla** (shadcn `DataTable`/`Table`), agrupable/segmentable por `sourceType` (`Tabs` opcional), con acciones inline por fila:
  - Fila de **carga**: "Editar costo" (`Dialog`: monto + motivo, muestra antes→ahora) y toggle "2º a bordo".
  - Botón global "Agregar ingreso" (`Dialog`: tipo `recoleccion|pod|dex|manual`, tracking opcional, monto, fecha **dentro de la semana**, motivo).
- **Buscar paquete** (`Dialog`): input tracking → estatus **interno** vs **FedEx** lado a lado (`Badge`), + income ligado; botón "Corregir estatus" (aplica a shipment y muestra el efecto en income). Si el resolver falla → mensaje "no se pudo verificar" y el botón queda **deshabilitado** (no adivinar).
- Overlay de loader como en `ingresos` (`Loader2`).

### 6.2 Datos (FE)

- `lib/services/consolidador.ts` — cliente HTTP de los endpoints §5.1.
- `hooks/services/consolidador/*` — react-query. Cada mutación **invalida** la query de la semana (`['consolidador', subsidiaryId, from, to, filtros]`) para refrescar KPIs+tabla. Rollback + toast (`sonner`) en error.

## 7. Manejo de errores

- Monto `>= 0`; `reason` obligatorio en todo write (validación FE + DTO BE con `class-validator`).
- FedEx: fallo del resolver → no se permite corregir estatus; se informa y se deja el estatus interno intacto.
- Alta manual: guard anti-duplicado (mismo `trackingNumber` + `date` + `kind` en la semana) para no doblar ingresos.
- Concurrencia: opcional `If-Unmodified-Since`/chequeo de `updatedAt` (v2 si hace falta; v1 último-escribe-gana con auditoría).

## 8. Pruebas

- **BE (Jest)**: las 3 funciones puras (§5.3) con casos borde (2º a bordo idempotente, DEX en semana correcta, `deriveStatusCorrection` sin diff → `none`). Unit de servicios con repos y `FedexStatusResolver` mockeados.
- **FE (Vitest)**: emparejado semana↔filtros (consolidado/ruta), validación del `Dialog` de costo (monto/motivo), y render del diff interno-vs-FedEx.

## 9. Fases (un solo spec, PRs incrementales)

- **F0 — Lectura**: migración + `GET /consolidador/...` + página con barra de filtros, KPIs y tabla read-only. Emparejado semana + filtros consolidado/ruta.
- **F1 — Costos de carga**: `PATCH /income/:id/cost` + `/second-abord` + dialog/toggle. Funciones puras `computeSecondAbordDelta` + tests.
- **F2 — Alta manual**: `POST /income` + dialog "Agregar ingreso" + `resolveManualIncomeCost` + guard anti-duplicado.
- **F3 — Estatus FedEx**: `GET /package/:tracking` + `PATCH /package/:shipmentId/status` + dialog de búsqueda/comparación + `deriveStatusCorrection`.

## 10. Fuera de alcance (v1, YAGNI)

- Bandeja de **aprobaciones** (se eligió acceso directo).
- Filas contables de **reversa**/anulación desde el consolidador.
- **Edición masiva** de filas.
- **Export** nuevo (se reusa el existente si el shape encaja).
- Acoplar la corrección a `tracking-sync` (se usa solo el resolver read-only).

## 11. Coexistencia (no romper lo que funciona)

- `income` (solo lectura) y `app/ingresos` (reportes) quedan **intactos**.
- El flujo de devoluciones (mig 064: `active`/`annulledAt`/`reversalOfIncomeId`) no se toca.
- El motor unificado FedEx / `tracking-sync` no cambia; el consolidador solo **lee** vía `FedexStatusResolver`.

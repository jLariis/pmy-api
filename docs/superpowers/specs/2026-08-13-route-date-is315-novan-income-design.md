# Fecha de ruta editable, flag 31.5 e ingresos de paquetes "No VAN" — Diseño

**Fecha:** 2026-08-13
**Repos:** `pmy-api` (backend, NestJS/TypeORM) + `app-pmy` (frontend, Next.js)
**Módulo:** Salidas a ruta / Cierre de ruta

---

## 1. Problema

En el flujo de **salidas a ruta** y su **cierre**:

1. **Fecha de ruta no controlable.** El ingreso del cierre (DHL, recolecciones) se ancla a
   `packageDispatch.createdAt` (día en que se creó el despacho). No hay forma de fijar
   explícitamente a qué día pertenece la ruta; si el despacho se crea en un día distinto
   al operativo, el ingreso cae en el bucket equivocado.
2. **Los paquetes "No VAN" no generan ingreso.** Hoy solo se guardan en
   `shipment_not_in_files`. Existe un TODO explícito en
   `routeclosure.service.ts:116` ("Faltaría agregar el ingreso de los paquetes que
   cumplan como lo hace para agregar los de DHL"). Deben cobrarse cuando su estatus FedEx
   y las reglas de cobro lo permitan.
3. **No hay distinción de ruta 31.5.** En rutas 31.5 los no-van NO deben cobrarse; en
   rutas normales SÍ (cuando cumplen reglas). No existe la propiedad para diferenciarlas.

## 2. Decisiones tomadas (con el usuario)

- **`routeDate` e `is315` son propiedades del DESPACHO** (`PackageDispatch`), fijadas al
  **crear la salida a ruta**. No se editan luego en el cierre.
- **`routeDate`**: fecha (solo día) que **por defecto es hoy** (día Hermosillo). Reemplaza
  a `createdAt` como ancla de TODOS los ingresos del cierre.
- **`is315`**: booleano, default `false`. `true` ⇒ los no-van NO generan ingreso;
  `false` ⇒ los no-van SÍ generan ingreso cuando cumplen reglas.
- **Re-validación en backend contra FedEx** para cada no-van al cerrar (autoritativo),
  porque se necesita el estatus FedEx real para decidir si cobra o no cuando `is315=false`.
  Las llamadas FedEx se hacen **antes de abrir la transacción** del cierre.
- **`charge_rule` sigue siendo la única fuente de "qué cuenta"** al leer (igual que DHL):
  el ingreso no-van se guarda SIEMPRE con costo completo + código; la contabilización la
  decide `isCountableIncome`/`charge_rule` en lectura.

## 3. Arquitectura general

```
Salida a ruta (crear despacho)
  ├─ Front: date picker "Fecha de ruta" (default hoy) + switch "¿Ruta 31.5?"
  └─ Back: PackageDispatch.routeDate + PackageDispatch.is315  (migración, columnas nullable/defaulted)

Cierre de ruta
  ├─ Front: sin cambios (ya manda noVanPackages con su status FedEx)
  └─ Back (routeclosure.service.create):
        routeIncomeDate = hermosilloDayStart(dispatch.routeDate ?? dispatch.createdAt)
        1) PRE-transacción: si !is315 y hay no-van → resolver estatus FedEx de cada no-van
        2) En transacción: DHL + recolecciones (ancladas a routeIncomeDate)
        3) En transacción: por cada no-van resuelto → Income (costo FedEx completo,
           incomeType/nonDeliveryStatus según outcome, date=routeIncomeDate),
           guard anti-duplicado (trackingNumber, sourceType=SHIPMENT)
```

## 4. Modelo de datos

### 4.1 `PackageDispatch` (tabla `package_dispatch`) — dos columnas nuevas

| Columna | Tipo | Null/Default | Notas |
|---|---|---|---|
| `routeDate` | `date` | nullable | Día operativo de la ruta. Front lo manda al crear (default hoy). Fallback a `createdAt` si null (rutas viejas). |
| `is315` | `boolean` | default `false` | Marca de ruta 31.5. |

- **Migración** `1786000000051-AddRouteDateAndIs315ToDispatch.ts`: `ADD COLUMN routeDate DATE NULL`,
  `ADD COLUMN is315 TINYINT(1) NOT NULL DEFAULT 0`. `down()` hace los `DROP COLUMN`.
- Entidad `package-dispatch.entity.ts`: agregar ambas columnas (`routeDate: Date | null`,
  `is315: boolean`).

### 4.2 `Income` — sin cambios de esquema

Los ingresos de no-van reutilizan la tabla `income` tal cual:
`trackingNumber` (sin FK obligatorio), `shipmentType=FEDEX`, `sourceType=SHIPMENT`,
`cost`, `incomeType`, `nonDeliveryStatus`, `date`, `subsidiary`, `createdById`.

### 4.3 `shipment_not_in_files` — sin cambios

Los no-van se siguen registrando ahí igual que hoy (persistencia del hecho "no fue").

## 5. Backend — componentes

### 5.1 DTOs

- **`CreatePackageDispatchDto`**: agregar
  ```ts
  @IsOptional() @IsDateString() routeDate?: string;   // 'YYYY-MM-DD'
  @IsOptional() @IsBoolean()    is315?: boolean;
  ```
- **`CreateRouteclosureDto.noVanPackages`**: cambiar `string[]` →
  ```ts
  interface NoVanPackageInput { trackingNumber: string; status?: string; isCharge?: boolean; }
  noVanPackages: NoVanPackageInput[];
  ```
  El front ya envía objetos con esta forma; solo se corrige el tipo. La extracción de
  `trackingNumber` en `create()` (que ya tolera string|objeto) se mantiene compatible.

### 5.2 `PackageDispatchService.create()`

- Al crear el `PackageDispatch`, setear:
  - `is315: dto.is315 ?? false`
  - `routeDate: dto.routeDate ? new Date(dto.routeDate) : <hoy día Hermosillo>`
  - (Si `routeDate` viene, se guarda tal cual el día; el default se calcula en backend para
    no depender de la zona del cliente.)

### 5.3 `RouteclosureService` — resolución FedEx de no-van

Nuevo método autoritativo (no reusa el string lossy de `getBestFedexStatus`; trabaja sobre
los **códigos** FedEx de la respuesta cruda):

```ts
interface NoVanFedexOutcome { trackingNumber: string; delivered: boolean; dexCode: string | null; resolved: boolean; }
private async resolveNoVanOutcome(trackingNumber: string): Promise<NoVanFedexOutcome>
```

Reglas de resolución (mismo arbitraje Header vs Scans que ya existe):
- **Entregado**: `latestStatusDetail.code === 'DL'` (o scan derivado equivalente) ⇒
  `delivered=true, dexCode=null`.
- **Excepción DEX**: `code==='DE'` ⇒ `dexCode` = código específico del scan/ancillary
  (03/07/08…), `delivered=false`.
- **Otro estatus (en tránsito, etc.)**: `resolved=true, delivered=false, dexCode=null`.
- **No encontrado / error**: `resolved=false`.

> La lógica de arbitraje (selección de generación por UniqueID, reintento label-only,
> Header vs Scans) se **extrae a un helper compartido** para no duplicarla entre
> `getBestFedexStatus` (endpoint de validación/UI) y `resolveNoVanOutcome`.

### 5.4 `RouteclosureService.create()` — generación de ingreso no-van

Flujo:

1. **Antes de `startTransaction()`**: si `!packageDispatch.is315` y hay no-van, resolver en
   paralelo `Promise.all(noVan.map(resolveNoVanOutcome))`. (FedEx fuera de la transacción.)
2. Dentro de la transacción, tras guardar `shipment_not_in_files` (bloque existente),
   reemplazar el TODO de la línea 116 por:
   - Si `is315` ⇒ **no** generar ingresos no-van (log informativo). Fin.
   - Si `!is315`, por cada outcome con `resolved === true` **y** (`delivered` **o** `dexCode`):
     - Guard: si ya existe `Income` con `(trackingNumber, sourceType=SHIPMENT)` ⇒ omitir (warn).
     - `cost = subsidiary.fedexCostPackage ?? 0`; si `cost <= 0` ⇒ log `FINANCE_ERROR`
       (consistente con DHL/recolección).
     - Crear `Income`:
       - `shipmentType = FEDEX`, `sourceType = SHIPMENT`, `isGrouped = false`
       - `incomeType = delivered ? ENTREGADO : NO_ENTREGADO`
       - `nonDeliveryStatus = delivered ? null : dexCode`
       - `cost`, `date = routeIncomeDate`, `createdById = userId`, `subsidiary`
     - `charge_rule(fedex, DELIVERED|dexCode)` decide en lectura si cuenta.
   - Outcomes con `resolved === false` ⇒ **no** se cobra (no se pudo validar en FedEx); log warn.
3. `routeIncomeDate` pasa a:
   ```ts
   const routeIncomeDate = hermosilloDayStartFromInstant(
     packageDispatch.routeDate ?? packageDispatch.createdAt ?? new Date()
   );
   ```
   (`routeDate` es `date`; se ancla a su inicio de día Hermosillo, igual que hoy.)

> Nota: los no-van no cargan FK a `shipment`/`charge` (pueden no existir como fila del
> despacho). El `Income` se ancla por `trackingNumber` (patrón ya soportado por la entidad).

## 6. Frontend (`app-pmy`)

- **`components/package-dispatch/package-dispatch-form.tsx`** (crear salida a ruta):
  - Date picker **"Fecha de ruta"**, default hoy.
  - Switch **"¿Ruta 31.5?"**, default off.
- **`lib/services/package-dispatchs.ts`**: incluir `routeDate` (ISO `YYYY-MM-DD`) e `is315`
  en el payload de creación del despacho.
- **`lib/types.ts`**: agregar `routeDate?` e `is315?` al tipo del dispatch/creación.
- **Cierre (`close-package-dispatch-form.tsx`)**: **sin cambios** (ya manda `noVanPackages`
  con `status`).

## 7. Manejo de errores / borde

- Ruta vieja sin `routeDate` ⇒ fallback a `createdAt` (comportamiento actual, sin regresión).
- `is315=true` ⇒ los no-van se registran en `shipment_not_in_files` pero **no** generan ingreso.
- No-van no resuelto en FedEx ⇒ no se cobra (se registra el hecho, se loguea).
- FedEx caído durante el cierre ⇒ `resolveNoVanOutcome` devuelve `resolved=false`; el cierre
  no se rompe (los no-van simplemente no cobran; DHL/recolecciones siguen su curso).
- `fedexCostPackage=0` en sucursal con no-van cobrable ⇒ ingreso en $0 + `FINANCE_ERROR` log.

## 8. Qué NO se toca

- `isCountableIncome` / `charge_rule` / lectura de ingresos, dashboard, KPIs (los no-van
  entran por la misma puerta que DHL/FedEx).
- Flujo DHL y de recolecciones del cierre (solo comparten el nuevo ancla `routeIncomeDate`).
- `getBestFedexStatus` como endpoint de validación/UI (se refactoriza el arbitraje a un
  helper compartido, pero su contrato de salida no cambia).
- `shipment_not_in_files` (esquema y registro).

## 9. Criterios de aceptación

1. Al crear una salida a ruta puedo fijar la **fecha de ruta** (default hoy) y el switch
   **31.5**; ambos se persisten en `package_dispatch`.
2. Al cerrar una ruta **no 31.5**, cada no-van con estatus FedEx entregado o con DEX
   cobrable genera un `Income` (FedEx, costo de sucursal, fecha = `routeDate`), sin duplicar.
3. Al cerrar una ruta **31.5**, los no-van se registran pero **no** generan ingreso.
4. Los ingresos de DHL y recolecciones del cierre quedan anclados a `routeDate`, no a la
   fecha de cierre ni a `createdAt`.
5. Rutas antiguas (sin `routeDate`) siguen anclando a `createdAt` sin errores.
6. `tsc` compila sin errores nuevos; no hay regresión en el cierre existente.

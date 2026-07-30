# Modo de validación de paquetes por sucursal (salidas a ruta)

**Fecha:** 2026-07-29
**Estado:** Diseño aprobado
**Alcance:** `package-dispatch` (salidas a ruta) únicamente.

## Problema

En salidas a ruta, la validación de paquetes en el frontend (`handleValidatePackages`)
recorre la lista escaneada/pegada y llama al endpoint uno-por-uno
(`GET /package-dispatchs/validate-tracking-number/:trackingNumber/:subsidiaryId`),
generando **N requests** para N paquetes.

Ya existe una config por sucursal para el **orden** (`sortDispatchByPostalCode`:
CP vs orden de escaneo), pero:

1. No existe una config equivalente para el **modo de validación** (uno-x-uno vs por lista).
2. El ordenamiento configurable solo se honra en el **frontend** (pantalla viva).
   El backend, en las vistas persistidas y en PDF/Excel, ordena por CP **siempre**,
   ignorando el flag:
   - `getShipmentsByPackageDispatchId` (`package-dispatch.service.ts:1069`)
   - `findOne` (`package-dispatch.service.ts:1435`)
   - `loadRouteDispatchInput` → `sortByPostalCode: true` hardcode (`:1150`)

## Objetivo

Agregar una configuración **por sucursal** que decida el modo de validación
(uno-por-uno vs por lista), análoga a la config de orden ya existente. Crear el
método/endpoint backend para validar la lista completa en un solo request,
devolviendo los paquetes ya ordenados según la config de la sucursal. El frontend
toma la config de la sucursal seleccionada (soporta usuarios con más de una).

Como mejora asociada: centralizar el ordenamiento en backend y hacerlo
**config-aware**, corrigiendo el orden incondicional por CP de las vistas persistidas.

## Diseño

### 1. Nueva config por sucursal: `validateDispatchByList`

- Nueva columna booleana en `subsidiary`, `default false` (= comportamiento actual uno-x-uno).
- Cambios:
  - `src/entities/subsidiary.entity.ts` — nueva `@Column({ default: false }) validateDispatchByList: boolean;`
    con doc-comment (mismo estilo que `sortDispatchByPostalCode`).
  - `src/subsidiaries/dto/create-subsidiary.dto.ts` — `@IsBoolean() @IsOptional() validateDispatchByList?: boolean;`
    (`UpdateSubsidiaryDto extends PartialType(CreateSubsidiaryDto)` → el campo fluye a update sin cambios extra).
  - Migración nueva `src/database/migrations/1786000000041-AddSubsidiaryValidateDispatchByList.ts`,
    mismo patrón que `1786000000012-AddSubsidiarySortDispatchByCp.ts`
    (`SHOW COLUMNS ... LIKE` idempotente; `ADD COLUMN ... TINYINT(1) NOT NULL DEFAULT 0`).
- Config UI (frontend): toggle nuevo junto al de "ordenar por CP" en la pantalla de
  configuración de sucursal.

### 2. Nuevo endpoint batch de validación

- `POST /package-dispatchs/validate-trackings`
  - Body: `{ trackingNumbers: string[]; subsidiaryId: string }` (nuevo DTO con
    `@IsArray()`, `@IsString({ each: true })`, `@IsUUID()` / `@IsString()` para subsidiaryId).
  - Reusa internamente la lógica de `validateTrackingNumber(code, subsidiaryId)` por cada
    código (mismo resultado que el flujo uno-x-uno; sin duplicar reglas de negocio).
  - Devuelve `PackageInfo[]` **ya ordenado** por backend según
    `sortDispatchByPostalCode` de la sucursal.
- Controller: método `validateTrackings(@Body() dto)` en `package-dispatch.controller.ts`.
- Service: método `validateTrackingsList(trackingNumbers, subsidiaryId)`.

### 3. Ordenamiento config-aware y centralizado (backend)

- Nuevo helper privado `sortShipmentsForSubsidiary<T>(items, sortByPostalCode: boolean): T[]`
  (o firma que reciba la sucursal). Si `true` → `sortByRecipientZip`; si `false` →
  conserva el orden de entrada (orden de escaneo).
- Aplicar en:
  - Nuevo endpoint batch (punto 2).
  - `getShipmentsByPackageDispatchId` (`:1069`) — leer flag de la sucursal del dispatch.
  - `findOne` (`:1435`) — idem.
  - `loadRouteDispatchInput` (`:1150`) — `sortByPostalCode` = flag de la sucursal, no `true`.
- `sortByRecipientZip` se conserva como primitiva de orden por CP.

### 4. Frontend

- `components/package-dispatch/package-dispatch-form.tsx`:
  - Derivar `validateByList` de la sucursal seleccionada (`useSubsidiaries`, igual que `sortByCp`).
  - En `handleValidatePackages`: si `validateByList` → un solo call a nuevo servicio
    `validateTrackingsList(validNumbers, subsidiaryId)`; si no → loop actual uno-x-uno.
  - Merge/dedupe de resultados: sin cambios (misma lógica `dhlUniqueId || trackingNumber`).
- `lib/services/package-dispatchs.ts`: nuevo `validateTrackingsList(trackingNumbers, subsidiaryId)`
  → `POST /package-dispatchs/validate-trackings`.
- Config UI de sucursal: nuevo toggle `validateDispatchByList`.

## Decisiones tomadas

- **Ambos flujos coexisten.** Cada sucursal decide vía config; default = uno-x-uno (sin
  cambio de comportamiento para sucursales existentes).
- **Ordenamiento en pantalla viva se mantiene client-side** (`filteredValidPackages`),
  porque filtros/búsqueda reordenan interactivamente. El batch trae orden correcto y el
  sort de display aplica la misma regla (idempotente). El movimiento a backend aplica a
  vistas persistidas, PDF y Excel.
- **Sin cambios en reglas de validación** (FedEx/DHL, normalización, offline). El batch
  reusa la lógica existente.

## Testing

- Backend: test de `validateTrackingsList` — (a) valida N trackings en un request;
  (b) orden CP cuando `sortDispatchByPostalCode=true`; (c) orden de entrada cuando `false`.
- Backend: `getShipmentsByPackageDispatchId`/`findOne` respetan el flag (regresión del bug
  "siempre CP").
- Frontend: `handleValidatePackages` elige flujo según `validateDispatchByList`.

## Fuera de alcance

- Cierre de ruta y desembarque (aunque también validan por lista) — no se tocan.
- Cambios en revalidación offline (sigue uno-x-uno).

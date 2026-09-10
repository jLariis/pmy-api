# DHL: actualización automatizada vía API nativa (paridad con FedEx)

**Fecha:** 2026-09-10
**Rama sugerida:** `feat/dhl-native-tracking`
**Repos:** `pmy-api` (backend) y `app-pmy` (frontend, limpieza de UI WhereParcel).

## Objetivo

Rastrear las guías DHL con la **API oficial de DHL**, en el **mismo cron horario** que
FedEx, y **eliminar por completo** la integración con WhereParcel/17track (tercero).
Ya se cuenta con permisos y credenciales en `.env` (sin rate limit, autorizado).

## Contexto actual

- **FedEx** se actualiza cada hora en punto (`tracking.cron.service.ts` →
  `ShipmentsService.processMasterFedexUpdate` / `processChargeFedexUpdate`).
- **DHL** hoy usa WhereParcel: registro a webhooks cada hora `:30`
  (`handleDhlWebhookRegisterCron`) + polling de respaldo 1×/día `05:00`
  (`handleDhlFallbackPollCron`), vía `where-parcel-dhl.service.ts`,
  `where-parcel-webhook.controller.ts` y `dhl-tracking-cycle.ts`.
- Base ya preparada para la API nativa: `src/utils/dhl.utils.ts::mapDhlCodeToInternal`
  (canónico, con `chargeable`/`terminal`) y el enum `DhlStatusType` (OK/NH/BA/RD/CM).
  `DhlService` (`src/shipments/dhl.service.ts`) tiene un `trackPackage` incompleto.

## Hechos confirmados de la API (probados con guías reales)

- **Endpoint:** `GET https://api-eu.dhl.com/track/shipments?trackingNumber={tn}&service=express`
- **Auth:** header `DHL-API-Key: {DHL_CLIENT_KEY}`. **Sin token.** (El login de BlueDart en
  `DHL_API_AUTH` devuelve un JWT de sandbox de Apigee → se descarta.)
- **Identificador:** se consulta por el **`trackingNumber` de 10 dígitos** (guía maestra).
  El `dhlUniqueId`/JD **da 404** como parámetro de consulta.
- **Una guía por llamada** (no hay lote). Con concurrencia (pLimit). Sin rate limit.
- **Multi-pieza:** la respuesta incluye `details.pieceIds[]` (los JD) y `totalNumberOfPieces`.
- **Shape relevante:**
  - `shipments[0].status.statusCode` ∈ `pre-transit | transit | delivered | failure | unknown`
  - `shipments[0].status.status` (numérico, p.ej. `101`,`102`) y `.description`, `.remark`
  - `shipments[0].events[]` con `{ timestamp, statusCode, status, description, location, pieceIds? }`
    donde `status` es el **código DHL** (`OK`,`FD`,`PL`,`AR`, y NH/BA/RD/CM en incidencias).
  - Entregado confirmado: top-level `statusCode:"delivered"`, evento `status:"OK"`.
- **404** (`title:"No result found"`) = guía no encontrada (autenticación OK).

## Diseño

### 1. `DhlService` (limpiar/completar) — `src/shipments/dhl.service.ts`

- Eliminar el flujo de token BlueDart (`getSmartToken`, archivo `dhl-token.json`, `DHL_API_AUTH`).
- Corregir la variable: `DHL_CLIENT_ID` → **`DHL_CLIENT_KEY`** para el header `DHL-API-Key`.
- `trackByTrackingNumber(tn: string)`: GET Unified con `service=express`, header key.
  POST resiliente estilo `FedexService.postTracking` (reintentos 429/5xx/red con backoff+jitter;
  404 = "sin datos", no error; 401/403 = credencial inválida → log claro).
- `trackBatch(trackingNumbers: string[])`: `pLimit` (concurrencia configurable,
  `DHL_TRACK_CONCURRENCY`, default p.ej. 10), 1 guía/llamada. Devuelve
  `DhlNativeResult[]` normalizados (ver abajo). Guías 404 → resultado "sin datos" (se omite).
- Se conserva el parser de texto pegado (`parseDhlText*`) — es de otra herramienta, no se toca.

`DhlNativeResult`:
```
{ queryTrackingNumber: string; found: boolean;
  statusCode?: string;          // top-level: delivered|transit|failure|pre-transit|unknown
  eventCode?: string;           // código DHL del último evento (OK/NH/BA/RD/CM/FD/PL/...)
  timestamp?: string; description?: string; location?: string;
  pieceIds: string[]; }
```

### 2. Mapeo canónico — `src/utils/dhl.utils.ts`

- Nuevo `resolveDhlNativeStatus(statusCode?, eventCode?): CarrierStatusResolution`:
  - `delivered` → ENTREGADO (`chargeable:true, terminal:true`).
  - `failure` → traducir el `eventCode` con `mapDhlCodeToInternal` (NH/BA/RD/CM → DEX);
    si no reconoce, NO_ENTREGADO no-terminal.
  - `transit` → EN_TRANSITO (o EN_RUTA si el evento es de reparto), no-terminal, sin cobro.
  - `pre-transit` → PENDIENTE/RECOLECCIÓN, no-terminal, sin cobro.
  - `unknown`/sin dato → no persistir (null-equivalente; el llamador omite).
- Mantener `mapDhlCodeToInternal` (adapter DHL) y `classifyDhlException` (para etiqueta DEX/notif).
- **Eliminar** `mapWhereParcelStatusToLocal` y `map17TrackStatusToLocal` (quedan huérfanas).

### 3. Persistencia — `ShipmentsService`

`persistDhlNativeResults(results: DhlNativeResult[])` (reemplaza a `persistDhlTrackingResults`):
- Para cada resultado con `found`:
  - Resolver estatus con `resolveDhlNativeStatus`; si null → omitir.
  - **Multi-pieza:** localizar TODAS las filas cuyo `dhlUniqueId ∈ pieceIds` **o**
    `trackingNumber = queryTrackingNumber`; actualizar cada una.
  - Por fila: agregar `ShipmentStatus` (dedupe por mismo estatus+día, solo si el evento es
    más nuevo que el último historial) y actualizar `shipment.status`.
  - Si `resolution.chargeable` y estatus ENTREGADO y `subsidiary.generateDhlIncomeOnDelivery`
    → `generateIncomes` (idempotente, igual que hoy).
- Devuelve resumen `{updated, unchanged, notFound, skipped, errors}` (para logs del cron).
- `getDhlToPollNative(limit)`: guías DHL activas por **`trackingNumber`** (no `dhlUniqueId`),
  no terminales, `createdAt > cutoff(6m)`, **dedupe por trackingNumber** (una llamada por guía
  maestra cubre todas sus piezas). Orden `createdAt DESC`, `limit` configurable.

### 4. Cron — `tracking.cron.service.ts`

- Dentro de `@Cron(EVERY_HOUR)` (`handleCron`, tras FASE 1/2 FedEx) agregar **FASE 3: DHL**:
  `getDhlToPollNative` → `dhlService.trackBatch` → `persistDhlNativeResults`, con log de resumen.
- Un solo guard de re-entrada (`isRunning`) cubre las 3 fases (secuencial).
- **Eliminar** `handleDhlWebhookRegisterCron` (:30) y `handleDhlFallbackPollCron` (05:00),
  sus guards (`isRunningDhl`, `isRunningDhlReg`) y los caps `WHEREPARCEL_*`.
- Actualizar el log de `onModuleInit` para reflejar el nuevo esquema.

### 5. Borrado de WhereParcel/17track

- Eliminar archivos: `where-parcel-dhl.service.ts`, `where-parcel-webhook.controller.ts`,
  `dhl-tracking-cycle.ts`.
- `tracking.module.ts`: quitar provider `WhereParcelDhlService` y controller
  `WhereParcelWebhookController` (y sus imports).
- `.env`: quitar `WHEREPARCEL_*` y `DHL_API_AUTH` (BlueDart). Documentar `DHL_API_URL`,
  `DHL_CLIENT_KEY` (y opcional `DHL_TRACK_CONCURRENCY`, `DHL_POLL_CAP`).
- `ShipmentsService`: eliminar métodos muertos de WhereParcel/17track
  (`getDhlToRegisterForWebhook`, `markDhlWebhookRegistered`, `getActiveRegisteredDhl`,
  `getActiveRegisteredDhlTerminal`, `getUnregisteredDhl`, `countActiveRegisteredDhl`,
  `getDhlToPoll`, `persistDhlTrackingResults`) y el import de `NormalizedTrackingResult`.
- **Columnas BD** `seventeenRegisteredAt` / `seventeenReleasedAt`: se **conservan**
  (sin migración destructiva); solo se dejan de usar. (Opción futura: migración de drop.)
- **Endpoints del controller** (`shipments.controller.ts`):
  - `POST dhl/manual-track` → repuntar a nativo (`dhlService.trackBatch` + `persistDhlNativeResults`).
  - `POST dhl/sync-cron` → repuntar a nativo (`getDhlToPollNative` → `trackBatch` → persist, en 2º plano).
  - `GET dhl/quota` → **eliminar** (sin cuota con API nativa sin rate limit).
  - `POST dhl/webhooks/setup` → **eliminar** (no hay webhooks).
  - Quitar el provider `WhereParcelDhlService` de `shipments.module.ts` y el import del controller.

### 6. Frontend `app-pmy` (limpieza de UI WhereParcel)

Regla de la casa: solo shadcn (`@/components/ui/*`) + Tailwind; máquina dev de 8 GB (evitar
recompilaciones pesadas innecesarias).

- `lib/services/dhl-tracking.ts`: eliminar `getWhereParcelUsage` y `setupDhlWebhooks`;
  conservar `runDhlSyncCron` y la consulta manual (repuntadas al backend nativo). Renombrar el
  tipo `WhereParcelUsage` fuera.
- `components/configuracion/seventeen-track-quota-card.tsx`: **eliminar la tarjeta de cuota**
  (o reducirla a un simple botón "Sincronizar DHL ahora" que llame `dhl/sync-cron`). Quitar el
  botón de "Suscribir a webhooks". Retirar su uso donde se monte (Configuración).
- `app/auditoria/page.tsx`: cambiar la etiqueta del botón "Probar tracking DHL (WhereParcel)"
  a "Probar tracking DHL"; el handler sigue llamando `dhl/manual-track` (ahora nativo).
- `components/configuracion/subsidiary-config-panel.tsx`: actualizar el `hint` de
  `generateDhlIncomeOnDelivery` (quitar "(WhereParcel)"). El flag y su comportamiento se conservan.

### 7. Pruebas

- Unit `resolveDhlNativeStatus`: delivered/failure(NH,BA,RD,CM)/transit/pre-transit/unknown.
- Unit `persistDhlNativeResults`: multi-pieza (2 piezas mismo trackingNumber), dedupe por
  día, "más nuevo gana", ingreso en ENTREGADO con `generateDhlIncomeOnDelivery`.
- Fixtures: respuestas reales capturadas (entregada `4218248764`, en tránsito `2620515634`).
- No romper suites existentes; ajustar/retirar specs que referencien WhereParcel.

## No-objetivos

- No se toca el motor `tracking-sync` (shadow/cutover) en esta entrega.
- No se dropean columnas `seventeen*` (sin migración destructiva).
- No se cambia la lógica de ingreso por cierre de ruta (DEX se cobran ahí, como hoy).

## Riesgos

- **Multi-pieza / identidad:** confiar en `pieceIds` de la respuesta; fallback a match por
  `trackingNumber`. Cubierto por prueba.
- **Volumen:** sin rate limit declarado, pero se mantiene `pLimit` + `cap` por ciclo por
  prudencia (evita saturar BD/API en corridas grandes).
- **`service=express`:** todas las guías observadas son Express doméstico. Si aparece otro
  producto, el 404 se maneja como "sin datos" (no rompe el ciclo); se podrá ampliar `service`.

# Motor de Sincronización de Estados de Tracking (FedEx) — Diseño

**Fecha:** 2026-08-15
**Estado:** Aprobado para escribir plan de implementación
**Alcance de esta entrega:** Motor nuevo, aislado, en **shadow mode**, **solo sincronización de estatus**, **solo shipments FedEx normales**, con **cero contacto** con la tabla `shipment_status`.

---

## 1. Objetivo

Construir, desde cero, un **motor de sincronización de estados de tracking** cuya capa de scraping/consulta sea solo una pieza reemplazable. El motor mantiene nuestros paquetes sincronizados con el último estatus real de FedEx: consulta, normaliza, identifica el último evento cronológico, compara contra lo almacenado, registra solo cambios relevantes, evita duplicados (idempotente), conserva la fecha/hora real del evento, y recupera eventos ocurridos entre corridas. La arquitectura debe permitir agregar reglas de negocio y otros carriers sin reescribir el core.

No se reutiliza como solución principal la lógica actual (`processMasterFedexUpdate` / `processChargeFedexUpdate` en `src/shipments/shipments.service.ts`), aunque sí se estudió para entender entidades, relaciones y reglas.

## 2. Decisiones de alcance (acordadas)

| Decisión | Elección |
|---|---|
| Convivencia con el cron actual | **Shadow mode**: corre en paralelo, calcula lo que HARÍA, no cambia estatus real |
| Alcance financiero | **Solo estatus**; la generación de ingresos queda como *rule hook* declarado pero inactivo |
| Persistencia de eventos | **Reusar `shipment_status`** como destino final en el cutover (no durante shadow) |
| Aislamiento en shadow | **Opción A — aislamiento total**: durante shadow NO se migra ni se escribe `shipment_status`. El `ALTER TABLE` y el primer write se posponen al cutover |
| Cobertura | **Solo FedEx normales (`Shipment`)**; F2 (`ChargeShipment`) y otros carriers (DHL) son extensión posterior |

## 3. Análisis de la arquitectura actual

### Entidades
- **`Shipment`** (`src/entities/shipment.entity.ts`): `trackingNumber`, `status` (último estatus denormalizado), `statusHistory` (1‑N a `ShipmentStatus`), `fedexUniqueId`, `carrierCode`, `consNumber`, `consolidatedId`, `subsidiary`, `commitDateTime`, `receivedByName`.
- **`ShipmentStatus`** (`src/entities/shipment-status.entity.ts`): `status` (enum `ShipmentStatusType`), `exceptionCode`, `timestamp` (fecha real del evento FedEx), `notes`, `createdAt`. FK a `shipment` **o** `chargeShipment`.
- **`ChargeShipment`** (F2): fuera de alcance en esta entrega.

### Infraestructura reutilizable (limpia)
- **`FedexService`** (`src/shipments/fedex.service.ts`): token inteligente, backoff, manejo de 401/429, `trackPackage`, `trackBatch`. Pura infraestructura. **Se reutiliza** vía la capa `TrackingSource`.
- **`FedexStatusResolver`** + `fedex-status.mapping.ts` + `fedex-status.types.ts` (`src/fedex-status/`): capa read‑only que ya normaliza y valida a un `LatestStatusResult` canónico con un mapeo **nuevo e independiente**. Es la base correcta, pero **solo expone el último estatus**, no la lista completa de eventos para backfill. El `Normalizer` del motor promueve esta lógica a producir la lista completa.

### Lógica que NO se reutiliza
- `processMasterFedexUpdate` (`shipments.service.ts:8242`, ~430 líneas dentro de un archivo de ~9,668): mezcla fetch, selector de generación, dedup, escritura de historial, generación de ingresos (dinero), "time shield", candados terminales, OD por sucursal y mutación del shipment en un solo método.

### Cron actual
- `TrackingCronService.handleCron` (`src/tracking/tracking.cron.service.ts:45`), cada hora → `getShipmentsToValidate()` → `processMasterFedexUpdate()`. Guard de re-entrada `isRunning`.

### Problemas de la implementación actual (que este diseño corrige)
1. **Dedup frágil**: firma `timestamp_exceptionCode` — colisiona (dos eventos distintos con misma fecha/exception) y omite el `status`/`eventType`.
2. **Reglas de negocio hardcodeadas dentro del loop de fetch/persist**: imposible extender sin editar el método monstruo; alto riesgo por regla.
3. **Mapeo FedEx duplicado** en 3 lugares (`mapFedexStatusToEnum`, `mapFedexStatusToLocalStatus`, mapping nuevo).
4. **Identificación del "último evento" ad-hoc**: mezcla header vs. último scan con heurísticas dispersas (Time Shield, etc.).
5. **Trazabilidad/observabilidad parcial**: sin métricas por corrida consistentes ni tabla de reanudación/observación.
6. **Acoplamiento a FedEx**: no hay una frontera de "fuente" que permita otro carrier.

## 4. Arquitectura propuesta (por capas)

Módulo nuevo y aislado: **`src/tracking-sync/`**. No se toca `shipments.service.ts`.

```
Orchestrator ─► Source ─► Normalizer ─► Reconciler ─► RulesPipeline ─► Sink
 (batch,        (Tracking   (raw →        (eventos       (reglas de       (SHADOW:
  concurrencia,   Source      eventos       nuevos +       negocio          Observation
  reintentos,     interface;   normalizados  estatus        ordenadas,       recorder /
  breaker,        impl FedEx   completos +   propuesto,     vetos,           PROD futuro:
  dead-letter,    envuelve     validación)   idempotente)   side-effects     Persister TX)
  métricas)       FedexService)                             diferidos)
```

Cada capa es una unidad con una sola responsabilidad, interfaz definida y testeable en aislamiento.

### 4.1 `TrackingSource` (interface) + `FedexTrackingSource`
- **Qué hace:** obtiene datos crudos del carrier. Única capa que conoce FedEx.
- **Interfaz:** `fetch(refs: TrackingRef[]): Promise<RawTrackingResult[]>` donde `TrackingRef = { trackingNumber; fedexUniqueId?; carrierCode? }`.
- **Impl FedEx:** envuelve `FedexService.trackBatch`/`trackPackage` (token/backoff/429 ya resueltos). Aquí vive el **selector de generación**: cuando FedEx devuelve varios `trackResults` para una guía (guías recicladas), elige el de **secuencia mayor** (`trackingNumberUniqueId` seq) con desempate por fecha del último scan.
- **Depende de:** `FedexService`.
- **Extensible:** otro carrier = nueva clase que implementa `TrackingSource`. Nada más se toca.

### 4.2 `TrackingNormalizer`
- **Qué hace:** `RawTrackingResult → NormalizedTracking`.
- **`NormalizedTracking`:** `{ trackingRef, events: NormalizedEvent[], latest: NormalizedEvent | null, commitDateTime: Date | null, validation: StatusValidation }`.
- **`NormalizedEvent`:** `{ occurredAt: Date, derivedCode, statusCode, exceptionCode, eventType, description, location, status: ShipmentStatusType, eventKey: string }`.
- Produce la **lista completa** de eventos, **ordenada cronológicamente ascendente** por `occurredAt` (no por posición en el arreglo). `latest` = el de mayor `occurredAt`.
- Reutiliza `resolveCanonicalStatus` de `src/fedex-status/fedex-status.mapping.ts` (mapeo único). Valida calidad del dato (reusa la lógica de `StatusValidation`).
- **Depende de:** `fedex-status.mapping.ts`. No depende de la BD.

### 4.3 `EventReconciler` (función pura, sin BD)
- **Qué hace:** dado `NormalizedEvent[]` y el conjunto de `eventKey` ya conocidos, devuelve `ReconcileResult = { newEvents: NormalizedEvent[], proposedStatus: ShipmentStatusType | null, currentStatus, transition: { from, to } | null }`.
- `newEvents` = eventos cuya `eventKey` no está en el set conocido, ordenados cronológicamente (para conservar trazabilidad completa de múltiples cambios entre corridas).
- `proposedStatus` = estatus del último evento cronológico (antes de reglas).
- **Sin efectos secundarios**: 100% testeable con datos en memoria.

### 4.4 Clave de idempotencia — `eventKey`
Determinista, corazón del "sin duplicados":

```
eventKey = sha1(`${trackingNumber}|${occurredAtEpochMs}|${derivedCode || eventType}|${exceptionCode}|${scanLocationCity}`)
```

Reejecutar el proceso produce las mismas claves → no reinserta. Robusta ante eventos con misma fecha pero distinto tipo/ubicación (lo que el dedup legacy no distingue).

### 4.5 `SyncRulesPipeline` (Chain of Responsibility sobre `SyncContext`)
- **Patrón elegido:** Pipeline de reglas. Cada regla implementa `SyncRule`:
  ```ts
  interface SyncRule {
    readonly name: string;
    readonly priority: number; // orden explícito
    apply(ctx: SyncContext): void | Promise<void>;
  }
  ```
- **`SyncContext` (mutable):** `{ shipment, normalized, reconcile, proposedStatus, vetoedEventKeys: Set<string>, deferredEffects: DeferredEffect[], notes: string[] }`. Las reglas leen/mutan `proposedStatus`, pueden vetar la inserción de ciertos eventos y **encolar** side-effects (nunca ejecutarlos dentro de la regla).
- **Registro por DI de Nest:** las reglas se inyectan como array (`@Inject('SYNC_RULES')`) y el pipeline las ordena por `priority`. **Agregar una regla = un archivo nuevo + registrarla en el provider; cero cambios en el resto.**
- **Reglas iniciales activas:**
  - `TerminalLockRule` (prioridad alta): si el estatus actual es terminal (ENTREGADO / ENTREGADO_POR_FEDEX / DEVUELTO_A_FEDEX / RETORNO_ABANDONO_FEDEX) y el propuesto es operativo, **veta el retroceso**. Excepción: ENTREGADO siempre gana.
  - `ExternalDeliveryRule` (OD por sucursal): si `subsidiary.trackFedexExternalDelivery` y hay OD, ajusta a ACARGO_DE_FEDEX / ENTREGADO_POR_FEDEX según corresponda.
- **Reglas declaradas pero INACTIVAS (hooks para migrar después):**
  - `IncomeRule` (financiero): estructura y punto de enganche listos; no ejecuta en esta entrega.
  - `NotificationRule`: idem.
- **Preparadas para el futuro** (mismo mecanismo, sin reescritura): estatus que requieren acción específica, estatus a ignorar, reglas por tipo de paquete, por consolidado, por fechas, reingresos a FedEx.

### 4.6 `SyncSink` (interface) + implementaciones
Frontera que decide qué se hace con el plan. Dos implementaciones tras la misma interfaz `applyPlan(ctx: SyncContext): Promise<SinkOutcome>`:

- **`ShadowSyncSink` (ESTA ENTREGA):** **no toca** `shipment` ni `shipment_status`. Escribe una fila de observación en `tracking_sync_observation` con lo que HARÍA (estatus propuesto, #eventos que insertaría, comparación con el estatus legacy actual, issues). Idempotente por `(runId, shipmentId)`.
- **`PersistentSyncSink` (CUTOVER FUTURO, fuera de alcance):** en una transacción, inserta los `newEvents` no vetados como `ShipmentStatus` (con `eventKey`), actualiza `shipment.status`/`fedexUniqueId`/`carrierCode`/`receivedByName`, idempotente. Requiere la migración de columnas de `shipment_status` (ver §5).

Cambiar de shadow a producción = cambiar el binding de DI del `SyncSink`. Una línea.

### 4.7 `TrackingSyncOrchestrator`
- **Qué hace:** conduce el pipeline sobre muchas guías.
- Agrupa por `trackingNumber`, batching (p.ej. lotes de 250), concurrencia controlada con `pLimit` (p.ej. 6), reintento individual ante label-only/miss del prefetch, **circuit breaker** (si FedEx es inalcanzable y 0 éxitos, aborta la corrida), **dead-letter** de guías fallidas, **métricas** por corrida (`tracking_sync_run`), y guard de re-entrada.
- **Reanudación:** cada corrida deja su rastro en `tracking_sync_run`; el dead-letter permite reprocesar solo las fallidas.

### 4.8 `TrackingSyncMetrics`
- Contadores por corrida: `total`, `ok`, `noData`, `failed`, `aborted`, `matchesLegacy`, `divergesLegacy`, duración de prefetch y total. Se materializan en `tracking_sync_run`.

## 5. Cambios de base de datos

### 5.1 Esta entrega (shadow — aislamiento total, Opción A)
**No se toca `shipment_status`.** Solo tablas nuevas del motor:

- **`tracking_sync_run`** — 1 fila por corrida del orchestrator:
  `id (uuid)`, `startedAt`, `finishedAt`, `mode ('shadow')`, `total`, `ok`, `noData`, `failed`, `aborted (bool)`, `matchesLegacy`, `divergesLegacy`, `notes (text null)`.
- **`tracking_sync_observation`** — 1 fila por guía por corrida (lo que el motor HARÍA):
  `id (uuid)`, `runId (fk → tracking_sync_run, index)`, `shipmentId (char36, index)`, `trackingNumber (index)`, `proposedStatus (varchar)`, `legacyCurrentStatus (varchar)`, `wouldInsertEvents (int)`, `wouldInsertEventKeys (json/text)`, `match (bool)`, `issues (json/text)`, `createdAt`. Idempotente por índice único `(runId, shipmentId)`.

El `eventKey` vive dentro de `wouldInsertEventKeys` en la observación; **no** en `shipment_status` todavía.

Todo por **migración TypeORM** (respetando `DB_SYNC=false` en todos los entornos, incl. dev). Sin alterar columnas existentes → no rompe reportes, KPIs, ni la entidad `ShipmentStatus`.

### 5.2 Diferido al cutover (fuera de alcance, documentado)
- `shipment_status.eventKey VARCHAR(120) NULL` + índice — dedup robusto en la tabla real.
- `shipment_status.source VARCHAR(32) NULL` — trazabilidad del motor que escribió la fila.
- Filas legacy quedan en NULL (compatibles).

## 6. Manejo de duplicados, errores, reintentos y concurrencia

- **Duplicados:** `eventKey` determinista + `EventReconciler` que filtra por claves conocidas. En shadow, además, índice único `(runId, shipmentId)` en la observación.
- **Idempotencia:** reejecutar la corrida no genera datos nuevos ni inconsistentes (las claves y el índice único lo garantizan).
- **Errores:** cada guía se procesa aislada; un fallo no aborta el lote. Se acumula en dead-letter con motivo.
- **Reintentos:** reintento individual controlado ante label-only/respuesta vacía; backoff ya lo aporta `FedexService`.
- **Circuit breaker:** si FedEx es inalcanzable (N errores de red y 0 éxitos), se aborta la corrida sin marcar miles de guías como error.
- **Concurrencia:** `pLimit` para acotar paralelismo hacia FedEx (rate limiting) y contención de BD. En shadow no hay locks sobre `shipment` (no se escribe). Guard de re-entrada del cron.
- **Validación de respuestas:** `StatusValidation` marca respuestas sin `latestStatusDetail`/`scanEvents`, inconsistencias derivedCode vs. último evento, etc. → van a `issues`.

## 7. Enganche del shadow

Cron nuevo y separado en el módulo `tracking-sync` (no se modifica `TrackingCronService`), cada hora, desfasado del cron legacy para no competir por cuota de FedEx (p.ej. al minuto :15). Reutiliza `getShipmentsToValidate()` como fuente de universo de guías (solo lectura). Guard de re-entrada propio.

## 8. Preparación para reglas futuras y otros carriers

- **Reglas:** nuevas `SyncRule` se agregan como archivos independientes y se registran en el provider de `SYNC_RULES`. El pipeline las ordena por prioridad. Cubre toda la lista de reglas futuras (acciones por estatus, ignorar estatus, notificaciones, por tipo/consolidado/fecha, reingresos a FedEx) sin tocar el core.
- **Carriers:** implementar `TrackingSource` para otro carrier (p.ej. DHL) reutiliza Normalizer/Reconciler/Pipeline/Sink. El mapeo por carrier se aísla en su normalizador.

## 9. Criterio de éxito

Ejecutar el proceso repetidamente produce un resultado equivalente a:
**FedEx → obtener eventos → normalizar → identificar eventos nuevos → validar → aplicar reglas → (shadow) registrar el plan → dejar la observación consistente con el último estado conocido de FedEx**, de forma idempotente, trazable, escalable y extensible, **sin tocar `shipment_status` ni `shipment.status`** en esta fase.

## 10. Testing

- **`TrackingNormalizer`**: fixtures de respuestas FedEx (incl. `src/shipments/fedexTracking.json`) → eventos normalizados y `latest` correctos; orden cronológico; casos sin `latestStatusDetail`.
- **`EventReconciler`** (función pura): sets de `eventKey`, múltiples eventos nuevos, cero nuevos, idempotencia.
- **`SyncRulesPipeline`**: `TerminalLockRule` veta retrocesos; `ExternalDeliveryRule` por sucursal; orden por prioridad; veto de eventos.
- **`FedexTrackingSource`**: selector de generación (múltiples trackResults).
- **`ShadowSyncSink`**: idempotencia por `(runId, shipmentId)`; cálculo de `match` vs legacy.
- **Orchestrator**: batching, dead-letter, circuit breaker (con `FedexService` mockeado).

## 11. Fuera de alcance (explícito)
- Escritura real en `shipment_status`/`shipment.status` (cutover posterior).
- Generación de ingresos/cobros (hook inactivo).
- F2 (`ChargeShipment`) y otros carriers.
- Notificaciones.

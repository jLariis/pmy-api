# Panel Experimental de Sincronización de Tracking (FedEx) — Diseño

**Fecha:** 2026-08-16
**Estado:** Aprobado para escribir plan de implementación
**Repos:** `pmy-api` (backend: endpoints + servicios) y `app-pmy` (frontend: página `/dev/tracking-sync`).
**Depende de:** motor de sincronización de la rama `feat/tracking-sync-engine` (Source/Normalizer/Reconciler/RulesPipeline/ExistingEventLoader ya construidos).

---

## 1. Objetivo y dolor

Dar una herramienta **visual** para comprobar —y opcionalmente corregir— que nuestros estatus coinciden con el último estatus real de FedEx. Nace de una queja recurrente del usuario: **en devoluciones y salidas a ruta no se reflejan los últimos estatus de los paquetes**. El panel debe demostrar, guía por guía, si FedEx muestra algo más nuevo que nosotros, y permitir a un superadmin corregirlo al momento.

## 2. Decisiones acordadas

| Decisión | Elección |
|---|---|
| Fuente de datos | **Comparación en vivo (on-demand)** contra FedEx; no depende del cron shadow |
| Puntos de entrada | **Por guía individual**, **por salida a ruta** (`package_dispatch`), **por devolución/consolidado** |
| Escritura | **Lectura + botón "Corregir ahora"** (aplica el estatus de FedEx, status-only) |
| Acceso | **Solo superadmin** |
| Límite de corrección en lote | **Sin límite** en la selección del usuario (internamente se procesa por guía en transacción, con concurrencia controlada hacia FedEx) |

## 3. Arquitectura

Reutiliza el motor existente (todo read-only) y agrega un servicio de comparación y un sink de escritura.

```
Frontend app-pmy /dev/tracking-sync  ──HTTP──►  TrackingSyncController (pmy-api, guard superadmin)
                                                     │
                       ┌─────────────────────────────┼──────────────────────────────┐
                       ▼                                                             ▼
              TrackingCompareService (READ-ONLY)                        PersistentSyncSink (WRITE, status-only)
              Source+Normalizer+Reconciler+Rules →                      inserta eventos faltantes + actualiza
              CompareResult[] (nuestro vs FedEx)                        shipment.status, TX, idempotente, auditado
```

Todo el backend vive dentro del `TrackingSyncModule` ya existente en `pmy-api`. No se toca `shipments.service.ts`.

### 3.1 Componentes backend

- **`TrackingCompareService`** (nuevo, read-only):
  - `compareByTracking(trackingNumber): Promise<CompareResult>`
  - `compareByRoute(routeId): Promise<CompareResult[]>` — todas las guías de un `package_dispatch`.
  - `compareByConsolidated(consolidatedId): Promise<CompareResult[]>` — todas las guías de un consolidado/devolución.
  - Para cada guía: carga `shipment` + su historial (`ExistingEventLoader`), consulta FedEx en vivo (`FedexTrackingSource`), normaliza (`TrackingNormalizer`), reconcilia (`EventReconciler`), corre reglas (`SyncRulesPipeline`) **sin escribir**, y arma el `CompareResult`.
- **`PersistentSyncSink`** (nuevo, write — no implementa la interfaz `SyncSink` del shadow, que usa `runId`; tiene su propia firma con `actor`):
  - `applyPlan(ctx, actor): Promise<ApplyOutcome>` — en transacción: inserta los `newEvents` no vetados en `shipment_status` (dedup por `shadowKey` contra el historial existente → idempotente, sin columna nueva), actualiza `shipment.status`/`fedexUniqueId`/`carrierCode`/`receivedByName` si cambian. **No genera ingresos.** Registra en auditoría (actor superadmin, guía, antes→después).
- **`TrackingSyncController`** (nuevo, guard superadmin — reusa el guard/rol que ya usa `FedexStatusController`):
  - `GET /tracking-sync/compare/tracking/:trackingNumber`
  - `GET /tracking-sync/compare/route/:routeId`
  - `GET /tracking-sync/compare/consolidated/:consolidatedId`
  - `POST /tracking-sync/apply` body `{ shipmentIds: string[] }` → aplica y devuelve resultado por guía.

### 3.2 Modelo `CompareResult` (DTO)

```ts
interface CompareResult {
  shipmentId: string;
  trackingNumber: string;
  ourStatus: ShipmentStatusType;
  ourLastEventAt: string | null;   // ISO
  fedexStatus: ShipmentStatusType | null;  // tras normalize + reglas
  fedexLastEventAt: string | null; // ISO
  diverges: boolean;               // ourStatus !== fedexStatus
  isStale: boolean;                // fedexLastEventAt > ourLastEventAt
  missingEvents: NormalizedEventDto[]; // eventos FedEx ausentes en nuestro historial
  fedexEvents: NormalizedEventDto[];   // timeline completo normalizado
  issues: string[];                // calidad del dato FedEx
  error?: string;                  // si FedEx no respondió
}

interface NormalizedEventDto {
  occurredAt: string; // ISO
  status: ShipmentStatusType;
  derivedCode: string | null;
  exceptionCode: string | null;
  description: string | null;
  location: string | null;
}
```

### 3.3 `ApplyOutcome` (DTO)

```ts
interface ApplyOutcome {
  shipmentId: string;
  trackingNumber: string;
  applied: boolean;
  fromStatus: ShipmentStatusType;
  toStatus: ShipmentStatusType | null;
  insertedEvents: number;
  skippedReason?: string; // p.ej. "sin datos FedEx", "bloqueado por candado terminal"
  error?: string;
}
```

## 4. Salvaguardas del "Corregir ahora" (único camino que escribe)

1. **Solo estatus, nunca dinero.** Inserta eventos faltantes + actualiza `shipment.status`. No genera ingresos/cobros; eso lo sigue haciendo el cron legacy.
2. **Idempotente.** Dedup por `shadowKey` (`timestampMs|exceptionCode|status`) contra el historial existente. Reejecutar no duplica.
3. **Pasa por las reglas.** `TerminalLockRule` (no retrocede terminales) y `ExternalDeliveryRule` (OD por sucursal). Se escribe el `proposedStatus` final tras reglas.
4. **Convive con el legacy.** Las filas insertadas tienen `timestamp`+`exceptionCode`+`status` reales → el dedup del cron legacy (`timestamp_exceptionCode`) las reconoce y no duplica. Corregir a ENTREGADO no impide que el legacy genere el ingreso en su próxima corrida.
5. **Confirmación + auditoría.** El modal muestra el diff exacto (de X a Y, N eventos) antes de aplicar; cada apply se registra vía `AuditModule` (superadmin, guía, antes→después).
6. **Transaccional y aislado por guía.** Un fallo en una guía no afecta a las demás. Lote sin límite de selección; internamente se procesa con concurrencia controlada hacia FedEx (mismo limitador interno del orquestador) y una transacción por guía.

## 5. Frontend (`app-pmy`)

- **Ruta:** `app/dev/tracking-sync/page.tsx` (carpeta `dev/` ya existe para experimentales).
- **Menú:** entrada "Experimental → Sincronización FedEx" en el sidebar (`components/main-sidebar.tsx` / `app-sidebar.tsx`), visible **solo para superadmin** (mismo mecanismo de visibilidad por rol que el resto del menú).
- **Servicio API:** `lib/services/tracking-sync.ts` siguiendo el patrón de `lib/services/*` + `lib/axios-config.ts`.
- **UI:**
  - Selector de modo: **[Por guía] [Por salida a ruta] [Por devolución/consolidado]**.
    - Por guía: input de tracking → consulta.
    - Por salida a ruta: selector/búsqueda de `package_dispatch` → lista sus guías comparadas.
    - Por devolución/consolidado: selector/búsqueda → lista sus guías comparadas.
  - **Resumen superior:** "N de M guías desactualizadas respecto a FedEx" (cuenta `isStale`/`diverges`).
  - **Tabla comparativa:** columnas Guía · Nuestro estatus · Últ. evento nuestro · Estatus FedEx · Últ. evento FedEx · ¿Diverge? · Eventos faltantes · acción. Filas con `diverges` o `isStale` resaltadas en color.
  - **Expansión de fila:** nuestro historial vs. timeline FedEx normalizado, marcando eventos faltantes.
  - **"Corregir ahora":** por fila y en lote (checkbox de selección + acción masiva, sin límite). Abre modal de confirmación con el diff; al confirmar llama `POST /tracking-sync/apply` y refresca.
  - **Estados:** loading, error de FedEx por guía (badge), vacío.

## 6. Entrega por fases (mismo spec/plan)

- **Fase A — Comparador (read-only, cero riesgo):** `TrackingCompareService` + endpoints de compare + página con tabla y expansión, sin botón de corregir. Ya da las garantías.
- **Fase B — Corrección:** `PersistentSyncSink` + endpoint `apply` + botón "Corregir ahora" con modal y auditoría.

## 7. Testing

- **`TrackingCompareService`** (backend, mocks de repos + `FedexTrackingSource`): arma `CompareResult` correcto; `diverges`/`isStale`/`missingEvents` bien calculados; guía sin datos FedEx → `error`; agrupa por ruta/consolidado.
- **`PersistentSyncSink`** (mocks de repos/manager): inserta solo eventos faltantes; idempotente (segunda corrida no inserta); respeta veto de reglas; NO llama a generación de ingresos; registra auditoría; una guía fallida no aborta el lote.
- **Coexistencia legacy:** test de que las filas insertadas tienen la forma que el dedup legacy reconoce (`timestamp`+`exceptionCode`+`status`).
- **Frontend:** Vitest de la página/servicio (el repo usa Vitest): render de tabla con divergencias, modo por ruta, y flujo de "corregir" (mock del servicio) — sin ejecutar `next dev` (máquina de 8GB; evitar OOM).

## 8. Fuera de alcance

- Escritura de ingresos/cobros (sigue en el legacy).
- Activar la escritura automática en el cron (cutover total); aquí la escritura es manual por superadmin.
- Historial shadow acumulado en la UI (esta iteración es en vivo on-demand).
- F2 (`ChargeShipment`) y otros carriers.

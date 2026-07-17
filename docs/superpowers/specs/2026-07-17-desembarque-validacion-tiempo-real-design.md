# Desembarque: validación de paquetes en tiempo real (uno por uno)

- **Fecha:** 2026-07-17
- **Autor:** Javier Laris (arquitectura asistida)
- **Repos afectados:** `pmy-api` (backend) + `app-pmy` (frontend)
- **Estado:** Aprobado — pendiente de plan de implementación

## 1. Problema

El proceso de validación en **desembarque** (unloading) genera quejas de los usuarios por
lentitud. En cada escaneo, el frontend reenvía **toda la lista acumulada** de guías (300+)
al endpoint `POST /unloadings/validate-tracking-numbers`. Aunque el payload marca
`isAlreadyValidated` para saltarse la BD en los repetidos, el backend **igual reconstruye la
foto completa por consolidado en cada llamada**:

1. `getConsolidateToStartUnloading` — arma los consolidados del día.
2. Recalcula `added` de cada consolidado recorriendo toda la lista.
3. Recalcula `notFound` con `calculateNotFoundFromConsolidates`, que **vuelve a la BD** a
   traer todos los paquetes de cada consolidado.

Ese recálculo global en cada escaneo (payload gigante + queries repetidas) es la causa de la
latencia.

**Modelo a seguir:** inventarios valida **uno por uno** (`GET
/inventories/validate/:trackingNumber`) y responde al instante.

**El reto particular de desembarque:** contabiliza los paquetes **por consolidado** (escaneados
vs. faltantes) para que el usuario sepa qué está llegando y si está correcto. Por eso no basta
con copiar el validador singular de inventarios: se perdería ese conteo en vivo.

## 2. Restricciones

- **La persistencia y las demás reglas NO se tocan:** `create()` (transacción, estatus
  `EN_BODEGA`, historial `ShipmentStatus`), reporte de visibilidad 67, endpoints de
  reporte/upload.
- El batch actual `validate-tracking-numbers` se **conserva** como respaldo/offline; no se
  elimina.

## 3. Observación arquitectónica clave

El conteo por consolidado tiene dos partes de naturaleza distinta:

- El **universo esperado** de cada consolidado (qué guías le pertenecen → la base de
  `notFound`) es **estático** durante la sesión: no cambia con lo que se escanea.
- Solo `added` crece con cada escaneo, y `notFound = esperado − added`.

Por lo tanto, el universo esperado se trae **una sola vez** al iniciar la sesión, y cada escaneo
solo necesita validar **un** paquete y decir a qué consolidado pertenece. El conteo se mantiene
incrementalmente en el cliente, sin reenviar la lista ni volver a la BD.

## 4. Decisiones tomadas

| Decisión | Elección |
|---|---|
| ¿Dónde vive el estado del conteo? | **En el cliente.** El backend entrega el universo esperado una vez; el front incrementa `added` y recalcula `notFound` localmente. |
| Alcance | **API + frontend** (ambos repos). |
| Forma de endpoints | **Endpoints nuevos y dedicados.** El batch y `create()` quedan intactos. |
| Rol del batch | Solo reconciliación offline. La validación uno-por-uno **reemplaza** al batch en el escaneo normal en línea. |

## 5. Arquitectura general

```
Hoy:   cada escaneo → POST [300+ trackings] → backend reconstruye TODO (added+notFound+queries) → respuesta pesada
Nuevo: al abrir     → GET session-init      → universo esperado por consolidado (1 sola vez)
       cada escaneo → POST validate-one {1} → { isValid, consolidatedId, datos } → cliente actualiza conteo
```

## 6. Backend (`pmy-api`) — dos endpoints nuevos

### 6.1 `GET /unloadings/session-init/:subsidiaryId`

Inicializa la sesión de desembarque entregando el universo esperado completo.

- Reusa `getConsolidateToStartUnloading` para armar los consolidados del día
  (aéreo / terrestre / F2), con `SubsidiaryScopeGuard`.
- Para cada consolidado calcula el **universo esperado completo**: guías + datos de
  destinatario (`recipientName`, `recipientAddress`, `recipientPhone`, `recipientZip`),
  **DHL-aware** (usando `dhlVariants` para las variantes JJD/JD y `dhlUniqueId`).
- Extrae la lógica de membresía ya existente en `calculateNotFoundFromConsolidates`, pero con
  conjunto escaneado vacío → devuelve **toda la membresía** (no el "faltante").
- Incluye la membresía **F2** vía la relación `charge` (hoy está comentada en el helper; se
  restablece aquí).
- Dedup por guía conservando el registro **más reciente** (`removeDuplicateTNs` /
  `createMostRecentMap`), igual que el flujo actual.

**Respuesta** (por consolidado, agrupados como en `ConsolidatedsDto`):

```ts
{
  airConsolidated:    ConsolidatedInitItem[],
  groundConsolidated: ConsolidatedInitItem[],
  f2Consolidated:     ConsolidatedInitItem[],
}

// ConsolidatedInitItem
{
  id: string;
  type: string;
  typeCode: 'AER' | 'TER' | 'F2';
  numberOfPackages: number;
  color: string;
  expected: ShortShipmentInfo[];   // universo esperado completo
}
```

No toca `create()`, ni estatus, ni historial. Es solo lectura.

### 6.2 `POST /unloadings/validate-one` — espejo de `inventories.validateTrackingNumber`

Valida **un** paquete con payload mínimo.

- **Body:** `{ trackingNumber: string; subsidiaryId: string }`.
- Decorado con `@NoAudit()` (validación por escaneo, muy frecuente, no auditable — igual que el
  batch).
- Busca primero en `shipmentRepository`, luego en `chargeShipmentRepository`, tomando el
  registro **más reciente** y **DHL-aware** (`dhlVariants`, búsqueda por `trackingNumber` y
  `dhlUniqueId`), excluyendo `DEVUELTO_A_FEDEX`.
- Aplica la **regla de sucursal** existente (`validatePackageResp`: el paquete debe pertenecer a
  la sucursal actual).

**Respuesta:**

```ts
{
  trackingNumber: string;
  isValid: boolean;
  isCharge: boolean;
  reason?: string;               // p.ej. "No pertenece a la sucursal", "No encontrado"
  consolidatedId?: string;
  recipientName?: string;
  recipientAddress?: string;
  recipientPhone?: string;
  recipientZip?: string;
  priority?: string;
  isHighValue?: boolean;
  payment?: any;
  commitDateTime?: string;
}
```

Instantáneo, sin recálculo de consolidados.

## 7. Frontend (`app-pmy`) — `components/operaciones/desembarque/unloading-form-wizard.tsx`

- **Al abrir / seleccionar consolidados:** llamar al nuevo `getUnloadingSessionInit(subsidiaryId)`
  y sembrar cada `SelectedConsolidate`:
  - `totalPackages` = `numberOfPackages`,
  - `missingPackages` = lista `expected` (guías esperadas).
  - Así el conteo de faltantes es correcto **desde el inicio** (hoy arranca vacío porque
    `getConsolidateToStartUnloading` devuelve `notFound` vacío).
- **En cada escaneo:** el efecto con debounce deja de enviar la lista completa. En su lugar, por
  cada tracking **nuevo** (no procesado antes) se llama `validateOne(trackingNumber, subsidiaryId)`.
  Con la respuesta:
  - se agrega a `shipments` y al `added`/`scannedPackages` del consolidado indicado por
    `consolidatedId`,
  - se quita de `missingPackages` de ese consolidado.
- El progreso por consolidado y los totales (`scannedPackages` / `missingPackages`) se actualizan
  en vivo, en O(1) por escaneo, sin round-trips pesados.
- Se conservan sin cambios: `localStorage` de la sesión, el modal de vencimientos
  (`ExpirationAlertModal`), buscador/filtros, y el Paso 3 (envío / PDF / Excel / correo) que sigue
  llamando a `saveUnloading` (→ `create()` intacto).

### 7.1 Servicios (`lib/services/unloadings.ts`)

Agregar dos wrappers:

```ts
const getUnloadingSessionInit = async (subsidiaryId: string) =>
  (await axiosConfig.get<UnloadingSessionInit>(`${url}/session-init/${subsidiaryId}`)).data;

const validateOne = async (trackingNumber: string, subsidiaryId: string) =>
  (await axiosConfig.post<ValidatedUnloadingOne>(`${url}/validate-one`, { trackingNumber, subsidiaryId })).data;
```

Se conserva `validateTrackingNumbers` (batch) para offline.

## 8. Manejo de errores y offline

- `validate-one` falla / sin conexión → se mantiene el flujo offline actual: el paquete se marca
  `isOffline` y se reconcilia al recuperar conexión (reusando el batch existente, o llamando
  `validate-one` por cada pendiente).
- Tracking no encontrado o de otra sucursal → `isValid:false` con `reason`, aparece en la pestaña
  correspondiente (igual que hoy).
- `session-init` falla → toast de error y no se permite avanzar (mismo comportamiento que la carga
  de consolidados actual).

## 9. Qué NO se toca

`create()` y su transacción, estatus `EN_BODEGA`, historial `ShipmentStatus`, reporte de
visibilidad 67, endpoints de reporte/upload, y el batch `validate-tracking-numbers` (queda como
respaldo/offline).

## 10. Criterios de aceptación

1. El escaneo normal en línea ya **no** envía la lista completa; cada escaneo hace una sola
   llamada `validate-one` con un tracking.
2. El conteo por consolidado (escaneados / faltantes / total) es correcto desde el inicio de la
   sesión y se actualiza en vivo con cada escaneo.
3. El desembarque final (`saveUnloading` → `create()`) persiste exactamente igual que antes
   (mismos estatus, historial y relaciones).
4. Guías DHL (JJD/JD/`dhlUniqueId`) y duplicadas (registro más reciente) se resuelven igual que
   en el flujo actual.
5. El modo offline sigue funcionando (marca `isOffline` y reconcilia al reconectar).
6. La latencia percibida en el escaneo es comparable a la de inventarios.

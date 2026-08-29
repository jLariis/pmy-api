# Importación de envíos y cargas por *jobs* asíncronos — Diseño

**Fecha:** 2026-08-29
**Estado:** Aprobado para implementación
**Repos afectados:** `pmy-api` (este spec). El frontend (`app-pmy`) se aborda en su propio ciclo.

## 1. Problema

La subida actual de "Envíos" (archivo maestro FedEx) —usada por el wizard de upload **y** por el "Pegar FedEx"— es intermitente: a veces sube, a veces no, y a veces no sube los paquetes completos. La ruta es
`POST /shipments/upload` → `addConsMasterBySubsidiary` → `processShipment` → `fedexService.trackPackage`.

Causas raíz confirmadas (ver análisis):

1. **Estado compartido de instancia** `this.shipmentBatch` en un servicio *singleton* (`@Injectable()` sin scope). Dos subidas concurrentes (dos usuarios, o el mismo usuario que reintenta) escriben en el mismo arreglo → paquetes de menos o mezclados. `shipments.service.ts:80, 2759, 2795, 3031`.
2. **Una guía que falle en FedEx tira todo.** Todo corre dentro de UNA transacción (`shipments.service.ts:2660`); `processShipment` hace `throw` ante error de FedEx (`:2904`) → rollback total. Cero commit parcial.
3. **Ráfaga de 100 llamadas FedEx concurrentes por lote** con `trackPackage` (1 guía/llamada) en `Promise.all` sin límite (`:2761`), en vez de `trackBatch` (30 guías/llamada, ya existe en `fedex.service.ts:246`). Dispara 429.
4. **Transacción larga + timeout de proxy.** Las llamadas FedEx (hasta 4 intentos × 15s) corren dentro de la transacción → la petición tarda minutos → el proxy corta y el cliente ve "Network Error" (documentado en `shipments.controller.ts:338`). El reintento del usuario dispara #1 y #5.
5. **Sin idempotencia ni lock por consolidado.** Dos peticiones con el mismo `consNumber` nuevo crean dos `Consolidated` (`:2661`).
6. **Se pierde el reporte de fallidas** porque el error aborta la transacción antes de devolver `result.failedTrackings`.

Las cargas/F2/31.5 (`processFileF2`) son más robustas (query runner propio, sin FedEx por guía) pero igual envuelven todo en una sola transacción, sin commit parcial ni progreso.

## 2. Objetivo

Una **herramienta nueva** de importación **exclusiva del "Pegar FedEx"** que deje el proceso 100% funcional, **sin tocar** el código que hoy funciona.

**El wizard NO se toca en absoluto.** El wizard de upload (envíos y carga/F2/31.5) sigue usando `/shipments/upload` y `/shipments/upload-charge` **sin ningún cambio**. La herramienta nueva se conecta **solo** al flujo de paste, y desde ahí cubre sus dos modos:

- **Pegar envíos** → `kind=master` (con enriquecimiento FedEx).
- **Pegar carga / F2 / 31.5** → `kind=charge`.

**La entrada son filas ya mapeadas (JSON), no archivo.** El FE (`app-pmy/lib/fedex-header-map.ts`) ya hace TODO el mapeo de columnas en el navegador y produce filas canónicas (`table.rows[].values` + flags `isHighValue`/`hasPayment`). Hoy el paste **sintetiza un Excel** con esas filas y llama a los endpoints del wizard; la herramienta nueva recibe **esas mismas filas como JSON**, evitando el Excel intermedio y **sin duplicar el mapeador** (~700 líneas) en el backend.

**El job encapsula TODO el flujo del paste en un solo `POST`.** Hoy el paste orquesta 1-2 llamadas por importación (principal + Alto Valor en `master`; principal + cobros en `charge`), lo que es frágil (si la 2ª llamada falla, queda estado a medias). El job lo unifica en **sub-pasos** guiados por los flags de fila:
- `master`: inserta envíos (pago inline desde `cod`) → **marca Alto Valor** (filas `isHighValue`).
- `charge`: inserta cargas → **aplica cobros** (filas con `cod`, vía `resolveCobroTarget`).

## 3. Decisiones de arquitectura (tomadas)

1. **Asíncrona por *job*.** `POST` responde al instante con un `jobId`; un worker en segundo plano procesa y reporta progreso; el front hace *polling*. Elimina timeouts de proxy sin importar el volumen pegado.
2. **Insertar y enriquecer con el cron (sin FedEx en el import).** El import de envíos **NO llama a FedEx**: inserta cada guía como `PENDIENTE` (con pago y Alto Valor) y el **cron existente** (`getShipmentsToValidate()` recoge `PENDIENTE` de los últimos 6 meses → `processMasterFedexUpdate`) pone estatus, historial e ingreso después, igual que ya hace con todo lo pendiente. **Cero reimplementación de la lógica FedEx y cero toque al código existente.** Ningún paquete se pierde por FedEx; costo: un paquete ya ENTREGADO tarda hasta el próximo cron en reflejarse.
3. **Job en BD (MySQL) + poller `@Cron`.** El job es una fila en la BD MySQL del proyecto (mysql2, `synchronize:false`). Un `@Cron` ligero **reclama** jobs `pending` con un **claim-token** (UPDATE optimista + SELECT, sin depender de `SKIP LOCKED`) y **recupera colgados** (reinicio del API a media subida). No requiere Redis (no hay en el stack).
4. **Todo en v1, "inline" en el módulo `shipments`.** El código nuevo son archivos y métodos **nuevos** dentro de `src/shipments/`; solo se **agregan** (aditivo) al `ShipmentsModule` la entidad, el controller y los providers nuevos. No se modifica lógica existente.

## 4. Alcance de v1

Incluye: **preview** (validación read-only sobre filas), **creación de job** (modos `master` y `charge`), procesamiento por lotes con progreso, **sub-pasos de Alto Valor y cobros**, polling de estado, **historial/monitor**, **descarga de no-enriquecidas/fallidas (Excel)** y **reintento solo de las no-resueltas**. El wizard queda intacto. Los cambios de UI del paste viven en `app-pmy` (otro ciclo); aquí se dejan los endpoints listos y el contrato de filas documentado.

## 5. Componentes (todo nuevo, dentro de `src/shipments/`)

### 5.1 Entidad `ImportJob` → tabla `import_job` (migración `1786000000061`)

| Campo | Tipo | Nota |
|---|---|---|
| `id` | uuid PK | |
| `kind` | enum `master` \| `charge` | |
| `status` | enum `pending` \| `processing` \| `done` \| `partial` \| `failed` | |
| `source` | enum `paste` \| `retry` | telemetría (siempre paste; `retry` = job hijo) |
| `subsidiaryId` | uuid | |
| `consNumber` | varchar | |
| `consDate` | datetime null | |
| `isAereo` | bool default false | solo `master` |
| `isHalfTon` | bool default false | solo `charge` (31.5 / 1.5 ton) |
| `notRemoveCharge` | bool default false | solo `charge` |
| `label` | varchar null | etiqueta legible del paste (ej. "Paste 2026-08-29 10:32") |
| `payloadHash` | varchar(64) | sha256 de `payloadRows`, para idempotencia |
| `payloadRows` | JSON (longtext) | **filas canónicas** ya mapeadas por el FE (auto-contenido) |
| `onlyTrackings` | JSON null | reintento: procesar solo estas guías |
| `claimToken` | varchar(36) null | token del worker que reclamó el job (patrón claim-token) |
| `parentJobId` | uuid null | reintento: job padre |
| `totalRows` | int default 0 | |
| `processedRows` | int default 0 | progreso |
| `saved` | int default 0 | |
| `duplicated` | int default 0 | |
| `recycled` | int default 0 | reingresos (guía que estaba en otro consolidado) |
| `failed` | int default 0 | fila que no se pudo insertar (dato malo / error de BD) |
| `hvMarked` | int default 0 | Alto Valor marcados (sub-paso `master`) |
| `cobrosApplied` | int default 0 | cobros aplicados (sub-paso `charge`) |
| `cobrosUnmatched` | int default 0 | cobros sin coincidencia de guía |
| `result` | JSON null | `{ failedTrackings[], duplicatedTrackings[], cobrosUnmatchedTrackings[], summary }` |
| `consolidatedId` | uuid null | consolidado creado/reutilizado (master) |
| `error` | text null | si el job entero falla |
| `attempts` | int default 0 | reintentos del worker |
| `claimedAt` `startedAt` `heartbeatAt` `finishedAt` | datetime null | control del worker |
| `createdById` `createdByName` | varchar null | auditoría |
| `createdAt` `updatedAt` | datetime | |

Índices: `(status, createdAt)` para el poller; `(subsidiaryId, kind, consNumber, payloadHash, createdAt)` para idempotencia e historial.

> `payloadRows` vive en la fila → el job es auto-contenido y sobrevive reinicios. Opcionalmente se persiste como `.csv` vía `ImportFilesService.persist` (bandeja de importación existente) para paridad de auditoría — sin bloquear si falla.

### 5.2 `ImportJobsController` (rutas nuevas, registrado en `ShipmentsModule`)

- `POST /import-jobs/preview` — **JSON** `{ kind, subsidiaryId, consNumber, consDate?, notRemoveCharge?, rows }`. **Read-only**: clasifica las filas contra BD (nuevas / reingresos / ya existen / duplicadas en el pegado) y valida `consNumber`. Reemplaza a `previewShipmentFile` del paste, pero **sobre filas** (sin Excel). Reutiliza la lógica de `previewUpload` existente adaptada a filas. Responde el mismo shape que hoy consume el FE (`withTracking, newCount, recycledCount, alreadyImportedCount, duplicatesInFile, consNumberExists, parseError`).
- `POST /import-jobs` — **JSON** `{ kind, subsidiaryId, consNumber, consDate?, isAereo?, isHalfTon?, notRemoveCharge?, source?, rows }`.
  `rows` = filas canónicas del FE (§5.5), **obligatorio**. Valida sucursal, **normaliza y valida** las filas (`parsePastedRows`; vacío/ilegible → 400), calcula `payloadHash`, aplica **idempotencia** (§7), inserta job `pending`, y responde `201 { jobId, totalRows, status, deduped? }`.
- `GET /import-jobs/:id` — estado + contadores + `result` (para el polling). No incluye `payloadRows`.
- `GET /import-jobs?subsidiaryId=&kind=&limit=` — historial reciente (sin `payloadRows`), `createdAt` desc. (monitor)
- `GET /import-jobs/:id/failed.xlsx` — descarga Excel de las guías `failed` (no se pudieron insertar) para revisión/reintento manual (se genera con `XLSX`).
- `POST /import-jobs/:id/retry-failed` — crea un **job hijo** (`kind` heredado, `source=retry`, `parentJobId`, `onlyTrackings` = las `failed` del padre, reutiliza `payloadRows` del padre). Devuelve `{ jobId }`.

### 5.5 Contrato de fila canónica (`rows[]`)

Espejo de lo que el FE ya produce en `table.rows[].values` (+ flags). Cada fila:

```
{
  trackingNumber: string,      // obligatorio
  recipientName?: string,
  recipientAddress?: string,   // el FE ya combina dirección + dirección2
  recipientCity?: string,
  recipientZip?: string,
  commitDate?: string,         // "yyyy-MM-dd" o formato FedEx; backend aplica default si falta
  commitTime?: string,
  recipientPhone?: string,
  cod?: string,                // celda de cobro cruda ("COD 1250.00"); backend usa parsePaymentCell
  isHighValue?: boolean        // solo master
}
```

Es exactamente el objeto `values` que el FE ya arma; migrar el paste = enviar `rows` en vez de sintetizar Excel. `parsePastedRows` solo **valida/normaliza** (guía obligatoria, tipos), **no** re-mapea columnas (eso lo hizo el FE).

Autorización: guard del permiso **`operaciones.pegarFedex`** (el paste ya lo exige).

### 5.3 `ImportJobsWorker` (`@Cron`, ~cada 5s)

- **Reclamar (claim-token, MySQL, sin `SKIP LOCKED`):** generar `token=uuid()`, luego
  `UPDATE import_job SET status='processing', claimToken=:token, claimedAt=NOW(), startedAt=COALESCE(startedAt,NOW()), attempts=attempts+1, heartbeatAt=NOW() WHERE status='pending' ORDER BY createdAt LIMIT :N`
  y a continuación `SELECT * FROM import_job WHERE claimToken=:token`. El UPDATE condicionado por `status='pending'` hace atómica la reclamación entre instancias.
- **Recuperar colgados:** jobs `processing` con `heartbeatAt` > 5 min → si `attempts < MAX` vuelven a `pending` (limpiando `claimToken`); si `attempts >= MAX` → `failed` con `error='stuck'`. (Los paquetes ya insertados en commits parciales quedan; el cron de enriquecimiento los completa.)
- **Heartbeat:** cada estrategia actualiza `heartbeatAt` + progreso al cerrar cada lote.
- Despacha por `kind` a la estrategia correspondiente en `ImportJobsService`.

### 5.4 `ImportJobsService`

Creación/consulta + las dos estrategias + los sub-pasos de Alto Valor y cobros. La lógica de inserción se **reescribe limpia aquí** (no llama a `processShipment` ni usa `this.shipmentBatch`, y **no** consulta FedEx). **`parsePastedRows(rows, kind)`** solo **valida y normaliza** las filas canónicas del FE (guía obligatoria, tipos, trims) — **no re-mapea columnas** (eso ya lo hizo `fedex-header-map.ts` en el navegador). Reutiliza helpers **puros**: `parsePaymentCell`, `resolveChargeCost`, `isSundayOrMexHoliday`, `resolveCobroTarget` (util existente para cobros); y servicios: `ConsolidatedService`, `HolidaysService`, `ImportFilesService`, `SubsidiaryService`. Alto Valor y cobros se reescriben **por filas** (nuevos métodos), reusando `resolveCobroTarget` y el mismo criterio de marcado que hoy — sin invocar los métodos basados en archivo. El enriquecimiento FedEx lo hace el **cron existente**, no este servicio.

## 6. Flujo de datos

### 6.1 Estrategia `master`

1. **Validar** `payloadRows` con `parsePastedRows` → filas canónicas. Si `onlyTrackings` (reintento), filtrar a esas guías.
2. **Clasificar** cada guía: *nueva* / *reingreso (recycle)* / *duplicada real*. Misma semántica que `addConsMasterBySubsidiary:2676-2751`, extraída a función pura `classifyMasterRows(rows, existingByTracking, targetConsId)`.
3. **Consolidado** find-or-create **una vez**, protegido por un **lock nombrado de MySQL** (`SELECT GET_LOCK(CONCAT('impcons:', :subsidiaryId, ':', :consNumber), 10)` … `SELECT RELEASE_LOCK(...)`) para no duplicarlo bajo concurrencia.
4. **Insertar en lotes cortos (~100) con commit progresivo.** Por lote, en UNA transacción corta:
   - Array **local** de `Shipment` (sin estado compartido, **sin FedEx**).
   - Mapear entidad: `status = PENDIENTE`, `commitDateTime` del row (o default), `consNumber`, `subsidiary`, `consolidatedId`; pago desde `cod` con `parsePaymentCell`; historial inicial `PENDIENTE` (nota "Registro inicial. Cons: …", igual que hoy). **Sin estatus/historial FedEx ni ingreso** — eso lo pondrá el cron.
   - Marcar reingresos viejos como `DEVUELTO_A_FEDEX` + nota (misma lógica actual) dentro de la misma transacción del lote.
   - `save` shipments + payments + historial inicial. **Commit.** Actualizar `saved`/`recycled`/`processedRows`/`heartbeatAt` del job.
   - **Tolerancia por guía:** un fallo al mapear/insertar una guía se captura, se cuenta en `failed[]`, y **no** aborta el lote (reintento individual fuera del `save` en lote; si aun así falla, se registra y se sigue).
5. **Sub-paso Alto Valor:** para las filas `isHighValue`, marcar los shipments recién creados como Alto Valor (match por guía; mismo criterio que hoy). Cuenta `hvMarked`. Un fallo aquí no revierte los envíos ya insertados (se registra en `result`).
6. Actualizar contadores del `Consolidated` y `status` del job (`done` si `failed==0`, `partial` si hubo fallidas, `failed` solo si nada se pudo insertar). El cron enriquecerá los PENDIENTE en su próxima corrida.

### 6.2 Estrategia `charge` (carga / F2 / 31.5)

Reescribe la semántica de `processFileF2` (migrar-o-insertar, `findOrCreateCharge`, dedup por `consNumber+subsidiary`, costeo con `resolveChargeCost(isHalfTon, domingo/festivo)`), pero:

- **Lotes cortos con commit parcial** y actualización de progreso, en vez de una transacción gigante.
- **Tolerancia por fila:** una fila mala no tira el job.
- **Sub-paso cobros:** tras insertar las cargas, para las filas con `cod` aplicar el pago con `resolveCobroTarget` (shipment > carga, por `consNumber`+guía, con fallback por tracking) — misma lógica que `processFileCharges`, pero **por filas**. Cuenta `cobrosApplied` / `cobrosUnmatched`.
- Idempotencia por `payloadHash` (§7). Sin FedEx por guía (igual que hoy).

## 7. Errores e idempotencia (cómo cierra cada causa raíz)

| Causa raíz | Cómo se resuelve |
|---|---|
| #1 estado compartido | Array **local** por invocación. Estrategias sin `this.<estado>` mutable. |
| #2 una guía tira todo | **Sin FedEx en el import** + **commit por lote** + tolerancia por guía → una fila mala nunca revierte el resto. |
| #3 ráfaga 429 | El import **no llama a FedEx**; el enriquecimiento lo hace el cron, que ya usa `trackBatch`+`pLimit`. |
| #4 timeout de proxy | Async: el HTTP responde al instante; el trabajo corre en el worker. |
| #5 consolidado duplicado | **Idempotencia** por `(subsidiaryId, kind, consNumber, payloadHash)` reciente (< ventana, ej. 30 min) → devuelve el job existente; **`GET_LOCK` nombrado** al crear el consolidado. |
| #6 reporte perdido | `result` persistido con `saved/duplicated/recycled/failed` + guías, más endpoints de descarga y reintento. |

## 7.1 Parámetros (defaults, configurables por env)

- Poller: cada **5s**, reclama **N=3** jobs por tick.
- Lote de inserción: **100** filas.
- Idempotencia: ventana **30 min**.
- Colgado: `heartbeatAt` > **5 min** → re-encolar; `attempts >= 3` → `failed`.
- (El import no llama a FedEx; el enriquecimiento es responsabilidad del cron existente.)

## 8. Coexistencia (no tocar lo que funciona)

- **Sin cambios** en `/shipments/upload`, `/shipments/upload-charge`, `addConsMasterBySubsidiary`, `processFileF2`, `processShipment`. Quedan como fallback.
- Cambios en `shipments.module.ts` **solo aditivos**: registrar `ImportJob` en `TypeOrmModule.forFeature`, agregar `ImportJobsController` y providers `ImportJobsService`, `ImportJobsWorker`.
- Migración `1786000000061-AddImportJobTable.ts` (DB_SYNC=false en todos los entornos → esquema siempre por migración).

## 9. Pruebas (Jest, junto a los specs existentes de shipments)

- `classifyMasterRows`: nueva/reingreso/duplicada.
- Mapeo fila→entidad `master`: `status=PENDIENTE`, `commitDateTime` del row/default, pago desde `cod`, historial inicial.
- Costeo `charge`: `isHalfTon` + domingo/festivo.
- **Idempotencia:** segundo `POST` con mismo `payloadHash` reciente → mismo job, sin consolidado duplicado.
- **`parsePastedRows`:** valida filas canónicas (guía obligatoria, trims); payload vacío → 400.
- **Preview:** clasificación read-only sobre filas (nuevas/reingresos/ya existen/dup en pegado) coincide con la del import real.
- **Recuperación de colgado:** job `processing` con heartbeat viejo → re-encolado; al superar `MAX` → `failed`.
- **Prueba clave (insertar como PENDIENTE):** todas las guías quedan `PENDIENTE` (sin llamada a FedEx) y son elegibles para `getShipmentsToValidate()`.
- **Prueba clave (tolerancia):** una guía que truena al insertar → las demás del lote se guardan (`failed++`, `partial`).
- **Sub-paso Alto Valor:** filas `isHighValue` marcan los shipments; un fallo del sub-paso no revierte los envíos (`hvMarked`, registro en `result`).
- **Sub-paso cobros:** filas con `cod` aplican pago vía `resolveCobroTarget` (`cobrosApplied`/`cobrosUnmatched`).
- Reintento: `onlyTrackings` procesa solo las no-resueltas del padre.

## 10. Fuera de alcance (v1)

- Cambios de UI en `app-pmy` (el **paste** apuntando a `/import-jobs` + barra de progreso) — ciclo aparte. **El wizard no cambia.**
- Migrar los crons de enriquecimiento (ya funcionan).
- Cola distribuida / Redis (innecesario; el poller en BD basta).

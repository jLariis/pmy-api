# Subida de consolidados sin reglas de paquete — Diseño

Fecha: 2026-09-04

## 1. Problema

De forma recurrente, al subir un consolidado (por Excel/método antiguo o por "pegar a
FedEx"), **una o más guías no se insertan**. La causa es la deduplicación por paquete:
una guía que el sistema considera "ya existe en este consolidado" o cuyo historial
dispara la lógica de reingreso queda descartada. El usuario decidió eliminar toda esa
lógica: prefiere insertar de más (y controlar manualmente el no re-subir) antes que
perder guías.

## 2. Decisión

Quitar **todas** las revisiones de paquete en la subida de consolidados master
(FedEx). La **única** regla que se conserva es el *find-or-create* del consolidado por
`consNumber` (scoped a sucursal + `ShipmentType.FEDEX`). Toda fila con guía válida se
inserta tal cual.

Se aplica a los dos caminos:
- **Método antiguo:** `ShipmentsService.addConsMasterBySubsidiary` (cableado en
  `shipments.controller.ts:348`).
- **Método pegar-a-FedEx:** `ImportJobsService.processMasterJob` +
  `classifyMasterRows` (util).

Decisiones tomadas con el usuario:
- **Duplicados:** insertar TODO, cero chequeos (ni siquiera guard dentro del mismo
  archivo/pegado). Re-subir un consolidado duplicará sus paquetes; es responsabilidad
  del usuario no re-subir.
- **Reingresos:** ignorar por completo. No se marca la guía vieja como
  `DEVUELTO_A_FEDEX`; solo se inserta la nueva ligada al consolidado actual.
- **Idempotencia de job (30 min por hash del pegado):** se **conserva**. No es una
  regla de paquete y no descarta guías sueltas; solo evita procesar dos veces el mismo
  pegado por un doble clic / reintento de red.

## 3. Qué NO se toca

- Variantes muertas `addConsMasterBySubsidiaryResp1108` / `previewUploadResp1108` /
  `previewUploadResp11082` (sin cablear en el controller).
- Estrategia `charge` (`processChargeJob`, F2/31.5): fuera de alcance, otro flujo.
- La idempotencia de `ImportJobsService.create`.
- El enriquecimiento posterior por cron (FedEx), income, cobros, etc.

## 4. Cambios por archivo

### `src/shipments/import-jobs.util.ts`
`classifyMasterRows` pasa a devolver **todas** las filas en `toInsert`, con
`duplicated: []`, `recycledTrackings: []`, `toMarkReturned: []`. Se mantiene la firma
para no romper llamadores; los parámetros de historial/estatus dejan de usarse.

### `src/shipments/import-jobs.service.ts`
- `processMasterJob`: eliminar el query de históricos (`existingRows`/`existing`) y el
  loop de marcado `DEVUELTO_A_FEDEX`. `duplicated`/`recycled` quedan en 0.
- `preview`: la clasificación reporta todo como nuevo (informativo).

### `src/shipments/shipments.service.ts`
- `addConsMasterBySubsidiary`: borrar el bloque de detección (`existingMap`, dedup
  "ya en este cons", reingreso + `DEVUELTO_A_FEDEX` + nota). `shipmentsToProcess` =
  todas las filas con tracking válido. `recycled`/`duplicated` = 0.
- `processShipment`: cuando `preFiltered` es `true`, **no** descartar por duplicado
  dentro del archivo (`processedTrackingNumbers`). El resto (consulta FedEx, mapeo)
  igual. El flujo legacy (`preFiltered=false`) conserva su dedup para no afectar código
  muerto/otros usos.

## 5. Tests

- `import-jobs.util.spec`: reescribir para el nuevo contrato (todas → `toInsert`;
  reingreso y "mismo cons" ya no se descartan; regresión del paste-dedup se ajusta o
  elimina).
- `import-jobs.service.spec`: `processMasterJob` inserta todas las filas, no marca
  `DEVUELTO_A_FEDEX`.

## 6. Criterios de aceptación

1. Subir un consolidado nuevo inserta el 100% de las filas con guía válida (ambos
   métodos).
2. Una guía que ya existía en otro consolidado se inserta en el nuevo **sin** marcar la
   vieja.
3. Una guía repetida dentro del mismo archivo/pegado se inserta las veces que aparezca.
4. El consolidado se reutiliza si `consNumber` ya existe; si no, se crea.
5. La idempotencia de 30 min sigue evitando el doble-procesamiento del mismo pegado.

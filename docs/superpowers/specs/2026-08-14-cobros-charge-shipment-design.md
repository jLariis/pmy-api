# Cobros en cargas (charge_shipment) desde el wizard de envíos — Diseño

**Fecha:** 2026-08-14
**Repos afectados:** `pmy-api` (backend), `app-pmy` (frontend)
**Estado:** Aprobado, listo para plan de implementación

## Problema

El paso **"Cobros"** del wizard de importación de envíos (`import-shipment-wizard.tsx`, step 4)
sube un archivo Excel a `POST /shipments/upload-payment`, que procesa
`ShipmentsService.processFileCharges`. Ese método **solo busca en la tabla `shipment`**
por `{ trackingNumber, recipientAddress }` y le asigna el `payment`.

Si la guía fue movida a `charge_shipment` (F2 / carga / 31.5), **ya no existe en `shipment`**,
por lo que el match falla **en silencio**: no hay error, no hay aviso, y el cobro simplemente
no se aplica. El operador cree que cobró la carga y no fue así.

El modelo de datos **ya soporta** cobros en cargas:
- `ChargeShipment.payment` es `OneToOne` con `cascade` (`charge-shipment.entity.ts:71`).
- `Payment.chargeShipment` es un FK real (`payment.entity.ts:47`).
- Las cargas F2 normalmente **no** traen un payment previo (el costo de flete se maneja como
  `Income` con `sourceType=CHARGE`, no como `Payment`), así que aplicar el cobro es **aditivo**
  y no pisa nada.

## Objetivo

Que el paso "Cobros" del wizard aplique el cobro también cuando el tracking corresponde a un
`charge_shipment`, exactamente como ya lo hace con los `shipment`, y que el operador reciba un
resumen de lo aplicado.

## Decisiones de diseño (acordadas)

1. **Precedencia:** shipment primero; si no hay shipment, fallback a charge_shipment.
   Nunca aplicar a ambas (evita doble cobro en reportes/KPIs).
2. **Llave de match:** `trackingNumber + consNumber` (el `consNumber` se toma del input del wizard),
   con **fallback** a `trackingNumber` solo, porque las cargas insertadas directo no siempre
   guardan `consNumber`.
3. **Feedback:** el backend devuelve conteos y el toast del wizard los muestra.
4. **Fix F2:** los caminos de creación de `charge_shipment` guardarán `consNumber`
   (y `consolidatedId` cuando esté disponible) para que las cargas futuras hagan match limpio.

## Hallazgo que motiva el fallback

`consNumber` / `consolidatedId` **no** están garantizados en `charge_shipment`:
- **Migración** (`processFileF2` escenario A, `service.ts:890`): usa `...original`, hereda `consNumber`. ✅
- **Inserción directa** (`processFileF2` escenario B, `service.ts:931`) y modo "no migrar"
  (`addChargeShipments`, `service.ts:1085`): no setean `consNumber` explícitamente → suele quedar `null`. ❌

Los `shipment` normales sí tienen `consNumber` confiable. De ahí el match por consNumber con
fallback por tracking, y el fix de F2 para cerrar el hueco hacia adelante.

## Algoritmo de resolución de match

Función pura, testeable, que dada una fila con cobro decide dónde aplicar el payment.
Por cada fila `{ trackingNumber, payment }` del archivo:

1. Buscar `shipment` por `{ trackingNumber, consNumber }`, orden `createdAt DESC`.
   Si existe → destino = ese shipment. **Fin.**
2. Buscar `charge_shipment` por `{ trackingNumber, consNumber }`, orden `createdAt DESC`.
   Si existe → destino = esa carga. **Fin.**
3. **Fallback** (cargas/guías sin consNumber): buscar `shipment` por `{ trackingNumber }` DESC;
   si no, `charge_shipment` por `{ trackingNumber }` DESC. Primero que exista → destino. **Fin.**
4. Nada → `unmatched`.

`consNumber` puede venir vacío (el paso Cobros es opcional en el flujo); si viene vacío,
los pasos 1–2 se saltan y se va directo al fallback por tracking (comportamiento equivalente
al actual pero cubriendo cargas).

## Cambios — Backend (`pmy-api`)

### `processFileCharges(file, consNumber?)`
- Nueva firma con `consNumber` opcional.
- Usa `chargeShipmentRepository` (ya disponible en el servicio).
- Aplica el algoritmo de resolución por cada fila.
- **Upsert del payment**: si el destino ya tenía `payment`, actualizar sus campos
  (`amount`, `type`, `status`) conservando el `id`, para no crear filas huérfanas en `payment`.
  Si no tenía, asignar el nuevo (cascade lo persiste).
- Devuelve:
  ```ts
  {
    total: number,          // filas con cobro en el archivo
    applied: number,        // aplicados a shipment
    appliedToCharges: number,// aplicados a charge_shipment
    unmatched: number,      // sin destino
    unmatchedTrackings: string[]
  }
  ```

### Controller `POST /shipments/upload-payment`
- Aceptar `consNumber` del body multipart (`@Body('consNumber')`), pasarlo al servicio.

### Fix F2 (creación de cargas guarda consNumber)
Setear `consNumber` explícito en los 3 puntos de creación de `charge_shipment`:
- `processFileF2` escenario A (`service.ts:890`) — reforzar que quede `consNumber` del param.
- `processFileF2` escenario B (`service.ts:931`).
- `addChargeShipments` (`service.ts:1085`).
Setear `consolidatedId` cuando el flujo lo tenga disponible. Cambio aditivo, sin migración de datos.

## Cambios — Frontend (`app-pmy`)

### `uploadShipmentPayments(file, consNumber?, onProgress?)`
- Agregar `consNumber` al `FormData` cuando esté presente.

### `import-shipment-wizard.tsx`
- En `handleNext` (step 4), pasar `consNumber` a `uploadShipmentPayments` (el estado ya existe).
- `summarizeResult(4, res)`: mostrar
  `"Cobros: {applied+appliedToCharges} aplicados ({appliedToCharges} a cargas), {unmatched} sin match."`

## Testing

- **Unit (backend):** extraer el resolver de match como función pura y probar:
  - match a shipment por consNumber,
  - fallback a charge_shipment por consNumber,
  - fallback por tracking-solo cuando falta consNumber,
  - sin match → unmatched,
  - precedencia shipment > charge cuando ambos existen.
  Patrón del repo: igual que `noVanIncomeDecision`.
- **Verificación manual:** subir un archivo de cobros con una guía que sea carga y confirmar
  que `charge_shipment.payment` queda poblado y el toast reporta `appliedToCharges >= 1`.

## Fuera de alcance

- Cambios en cómo route-closure / KPIs consumen `payment` de cargas (ya leen `chargeShipment.payment`).
- Migración retroactiva de `consNumber` en cargas históricas (el fallback por tracking las cubre).
- UI nueva; solo se reusa el toast existente.

---

# Addendum — Consolidado en cargas F2 (2026-08-14)

## Problema

`getShipmentsByConsolidatedId` ya está diseñado para mostrar cargas: consulta
`charge_shipment WHERE consolidatedId = ?` (`consolidated.service.ts:590`). Pero los flujos F2
no setean `consolidatedId`, así que las cargas no aparecen en el detalle del consolidado:

- **`addChargeShipments`** (F2 "solo sin migrar"): crea `Charge` + `Income`, nunca `Consolidated`.
- **`processFileF2` escenario B** (guía nueva que no existía en shipments): tampoco.
- **`processFileF2` escenario A** (migración): la carga hereda `consolidatedId` del shipment
  original vía `...original` → ya queda ligada. Se deja intacta.

## Decisiones (acordadas)

1. **Alcance:** `addChargeShipments` + escenario B de `processFileF2` (guías nuevas). Helper compartido.
2. **Comportamiento:** find-or-create por `consNumber` (normalizado, scoped a sucursal + FEDEX).
   Si el consolidado ya existe (los envíos se subieron primero), las cargas se **unen** a él.

## Implementación

- `findOrCreateChargeConsolidated(manager, { consNumber, subsidiaryId, date, userId })`:
  normaliza `consNumber` (trim+upper+colapsa espacios, espejo de `findByConsNumberScoped`),
  busca acotado a sucursal+carrier FEDEX, y crea si no existe (`isCompleted=false`,
  `type=ORDINARIA`, `numberOfPackages=0`). Devuelve `null` si no hay `consNumber`.
  Recibe el `EntityManager` para correr dentro de la transacción de `processFileF2` o con el
  manager por defecto en `addChargeShipments`.
- `bumpConsolidatedCount(manager, cons, count)`: suma al `numberOfPackages` al final.
- **`addChargeShipments`**: find-or-create upfront (siempre hay ≥1 carga), `consolidatedId` en
  cada carga, bump por `savedChargeShipments.length`.
- **`processFileF2`**: creación **lazy** (solo en la primera guía nueva, para no dejar
  consolidados vacíos cuando todo fue migración), `consolidatedId` en el create del escenario B,
  bump por `createdFromScratch.length` antes del commit.

## Fuera de alcance (addendum)

- No se re-liga el `consolidatedId` de las cargas migradas (escenario A).

---

# Addendum 2 — Idempotencia F2 (sin duplicados) (2026-08-14)

## Problema

Ni `addChargeShipments` ni `processFileF2` deduplicaban: re-subir el mismo F2 duplicaba
`charge_shipment`, la cabecera `Charge`, el conteo del consolidado y —lo más grave— el
**Income** (ingreso plano por carga → doble facturación).

## Decisiones (acordadas)

1. **Un F2 "load" = (consNumber + sucursal).** Re-subir el mismo consNumber **reutiliza** la
   `Charge` y **NO** genera otro `Income` (una carga = un cobro plano).
2. **Llave de duplicado de guía:** `trackingNumber + consNumber + sucursal` (ya existe como
   `charge_shipment` en ese consolidado ⇒ se omite). Espejo del flujo normal.

## Implementación

- `findOrCreateCharge(manager, {consNumber, subsidiaryId, chargeDate, isHalfTon})` →
  `{ charge, created }`. Busca por consNumber normalizado + sucursal; reutiliza si existe.
- `findExistingChargeTrackings(manager, trackings, consNumber, subsidiaryId)` → `Set` de
  trackings ya existentes como carga en ese consolidado.
- `bumpChargeCount(manager, charge, count)` — suma a `Charge.numberOfPackages`.
- **`addChargeShipments`**: dedup contra `Set` + duplicados dentro del archivo; si `newGuias=0`
  retorna `{duplicated, message}` sin crear nada; si hay nuevas, find-or-create Charge, inserta
  solo nuevas, bump Charge/Consolidado, e `Income` **solo si la Charge es nueva**.
- **`processFileF2`**: find-or-create Charge (antes creaba siempre); `dupSet` + `seenF2`
  (duplicados en archivo) omiten guías ya-carga; `Income` **solo si `chargeCreated`**; bump
  Charge por (migradas+nuevas) y consolidado por nuevas. Summary agrega `duplicated`.
- **Frontend**: `summarizeResult(3)` muestra duplicadas y el `message` de re-subida completa.

## Semántica resultante

| Escenario | charge_shipment | Charge | Income | Consolidado |
|---|---|---|---|---|
| Primera subida | inserta N | crea | 1 (plano) | crea/liga, +N |
| Re-subida idéntica | 0 (todas omitidas) | reutiliza | 0 | +0 |
| Re-subida parcial (M nuevas) | inserta M | reutiliza | 0 | +M |

## Fuera de alcance (addendum 2)

- Facturación por paquete (el modelo es plano por load; no se cambia).
- Unit/integration test del dedup (lógica embebida en métodos con BD; se verifica manualmente
  re-subiendo el mismo F2).

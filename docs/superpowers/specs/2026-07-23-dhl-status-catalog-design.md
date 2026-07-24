# Estatus DHL — catálogo propio y separación por carrier

**Fecha:** 2026-07-23
**Autor:** Javier / Claude (senior dev)
**Estado:** Aprobado para implementación (inline, sin subagentes)

## Problema

Los estatus de entrega hoy están amarrados a FedEx: los códigos DEX (`03`, `07`, `08`, `67`…)
se guardan como strings en `shipment_status.exceptionCode` / `Income.nonDeliveryStatus`, y el
enum interno `ShipmentStatusType` está conceptualmente ligado a FedEx (sus valores están comentados
con códigos DEX). DHL necesita sus propios códigos de entrega **que no choquen** con los de FedEx y
que **solo apliquen a DHL**:

| Código DHL | Etiqueta |
|---|---|
| `OK` | POD / Entregado |
| `NH` | No estaba / ausente (ref. DEX 08) |
| `BA` | Dirección incorrecta / Bad Address (ref. DEX 03) |
| `RD` | Rechazado / rehusado (ref. DEX 07) |
| `CM` | Cambio de domicilio |

El objetivo de fondo (dictado por el usuario): **dejar de ser específico de FedEx y pasar a un
modelo genérico** donde mañana se pueda enchufar un carrier nuevo con sus propios estatus, sin
romper la trazabilidad interna existente.

## Convención / arquitectura (en capas)

1. **Capa canónica interna** — el enum `ShipmentStatusType`, reconceptualizado como el ciclo de
   vida interno del paquete, **agnóstico al carrier** (`pendiente`, `en_bodega`, `en_ruta`,
   `entregado`, `cliente_no_disponible`, `direccion_incorrecta`, `rechazado`, …). Todo lo interno
   (inventarios, monitoreo, sin67, reportes, ingresos) consume **solo** esta capa. Aquí vive la
   trazabilidad que no se debe perder.
2. **Capa de código por carrier** — un catálogo propio por transportista: `dhl_status`
   (OK/NH/BA/RD/CM), `fedex_status` (DEX), y en el futuro `<nuevo>_status`. Extendible desde la UI.
   Nunca chocan porque son namespaces de valores distintos (DHL usa abreviaturas alfabéticas;
   FedEx usa códigos numéricos).
3. **Traductor por carrier (adapter)** — función pura `código_carrier → { estatusCanónico, cobra,
   terminal }`. FedEx ya tiene `mapFedexStatusToLocalStatus`; DHL tendrá `mapDhlCodeToInternal`.
   **Carrier nuevo = catálogo nuevo + traductor nuevo, sin tocar consumidores internos.**

## Mapeo DHL → canónico

| Código DHL | → Estatus canónico interno | ¿Cobra? | ¿Terminal? |
|---|---|---|---|
| `OK` | `entregado` | ✅ | ✅ |
| `NH` | `cliente_no_disponible` | ❌ | ❌ |
| `BA` | `direccion_incorrecta` | ❌ | ❌ |
| `RD` | `rechazado` | ❌ | ❌ |
| `CM` | `cambio_domicilio` **(nuevo valor canónico)** | ❌ | ❌ |

**Solo `OK` genera ingreso y es terminal.** Esto corrige el comportamiento actual de cierre de ruta,
donde los códigos 07/03/08 sí cobraban.

## Almacenamiento (sin colisión)

- El código DHL se persiste como fila de historial `shipment_status` con
  `exceptionCode = 'OK' | 'NH' | 'BA' | 'RD' | 'CM'`. Estos valores **nunca** hacen match con los
  filtros cableados de FedEx (`exceptionCode === '03'/'07'/'67'…`), así que "solo aplican a DHL"
  se cumple por construcción.
- `shipment.status` se actualiza al estatus canónico devuelto por el traductor (trazabilidad).

## Cambios concretos

### 1. Enum canónico
- `src/common/enums/shipment-status-type.enum.ts`: agregar `CAMBIO_DOMICILIO = 'cambio_domicilio'`
  **al final** del enum (después de `OTRO`). Ver nota de migración.

### 2. Enum + catálogo DHL
- Nuevo `src/common/enums/dhl-status-type.enum.ts`:
  `enum DhlStatusType { OK='OK', NH='NH', BA='BA', RD='RD', CM='CM' }`. Exportar en el índice de enums.
- `src/catalog/catalog-definition.ts`:
  - Extender `CatalogDef` con `labels?: Record<string, string>` (etiquetas explícitas por key).
  - `deriveItems` usa `def.labels?.[key]` si existe, si no `prettify(key)`.
  - Registrar `{ type: 'dhl_status', label: 'Estatus DHL', enumObj: DhlStatusType, labels: { OK:'POD / Entregado', NH:'No estaba', BA:'Dirección incorrecta', RD:'Rechazado', CM:'Cambio de domicilio' } }`.

### 3. Traductor DHL
- `src/utils/dhl.utils.ts`: agregar
  `mapDhlCodeToInternal(code: string): { internalStatus: ShipmentStatusType; chargeable: boolean; terminal: boolean }`
  con el mapeo de la tabla. Un código desconocido → `{ pendiente, false, false }`.
- Las funciones existentes `classifyDhlException` / `map17TrackStatusToLocal` /
  `mapWhereParcelStatusToLocal` quedan como **legado** (17track/WhereParcel ya no se usan). No se
  eliminan en este alcance.

### 4. Cierre de ruta
- `src/routeclosure/routeclosure.service.ts` (bloque DHL, ~L138-237):
  - Los items de `podPackages`/`returnedPackages` llevan `code: DhlStatusType` (default `OK`).
  - Resolver `{ internalStatus, chargeable }` con `mapDhlCodeToInternal(code)`.
  - **Ingreso solo si `chargeable` (o sea, solo `OK`).** Eliminar el mapeo actual
    `RECHAZADO/DIRECCION_INCORRECTA/CLIENTE_NO_DISPONIBLE → 07/03/08` que cobraba.
  - Insertar una fila `shipment_status` con `exceptionCode = code`, `status = internalStatus`,
    `timestamp = ahora`.
  - Actualizar `shipment.status` (o `charge_shipment.status`) a `internalStatus`.
- DTO (`src/routeclosure/dto/create-routeclosure.dto.ts` o el shape real que envía el front):
  reflejar el campo `code`.

### 5. Migración
- Nueva migración TypeORM:
  - `ALTER TABLE shipment MODIFY COLUMN status ENUM(..., 'otro', 'cambio_domicilio') ...`
    (valor nuevo **al final** → operación de solo metadatos, instantánea, no reescribe filas).
  - Igual para `shipment_status.status`.
  - Seed de items `dhl_status` en `catalog_item` (siguiendo el patrón de las migraciones
    `AddCatalogItems` existentes), o dejar que el seeding desde `CATALOG_DEFS` los cree.

## Nota de migración (rendimiento)

Agregar un valor de enum **al final** de la definición de la columna en MySQL es un cambio de
solo metadatos: NO copia ni reescribe la tabla, aunque tenga millones de registros. Solo sería
costoso si el valor se insertara en medio de la lista. Por eso `cambio_domicilio` va al final.

## Fuera de alcance

- Re-migrar el código FedEx existente a este patrón (fase posterior).
- Integración de feed automático (17track/WhereParcel descartados). El traductor queda listo para
  enganchar la **API oficial de DHL** el día que exista.
- Cambios de frontend (switch "todos entregados por defecto", selector de códigos DHL). El backend
  trata lo no especificado como `OK`.

## Criterio de éxito

- Cierre de ruta con paquetes DHL guarda el código DHL en historial sin chocar con filtros FedEx.
- Solo `OK` genera ingreso.
- `shipment.status` conserva/actualiza el estatus canónico interno; nada interno se rompe.
- `dhl_status` aparece en el catálogo y es extendible desde UI.
- La migración corre sin bloquear la tabla (solo metadatos).

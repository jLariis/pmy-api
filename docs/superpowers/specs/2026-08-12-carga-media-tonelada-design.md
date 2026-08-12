# Switch "Carga 1.5 toneladas" en el wizard de envíos

**Fecha:** 2026-08-12
**Repos:** `pmy-api` (backend) + `app-pmy` (frontend)

## Problema / objetivo

En el wizard de importación de envíos, el paso 3 (carga F2) genera un `Income`
cuyo `cost` es siempre `subsidiary.chargeCost`. Se necesita un switch nuevo,
**"Carga 1.5 toneladas"**, que cuando esté activo haga que el ingreso use un
costo distinto (por defecto **$3,900** para la sucursal **Hermosillo,
exclusivamente**) en lugar del `chargeCost` normal, y que ese hecho quede
guardado en BD y sea trazable.

## Decisiones tomadas (brainstorming)

1. **Dónde vive el costo:** nueva columna en la entidad `subsidiary`
   (`chargeCostHalfTon`), sembrada en 3900 **solo** para Hermosillo. Sigue el
   patrón de `chargeCost`. Configurable a futuro por sucursal.
2. **Alcance del switch:** solo Hermosillo hoy, implementado de forma
   **data-driven**: el switch se muestra/aplica únicamente cuando la sucursal
   seleccionada tiene `chargeCostHalfTon > 0`. No se hardcodea el nombre
   "Hermosillo" en la lógica; se auto-extiende si se configura otra sucursal.
3. **Trazabilidad:** nueva columna booleana `isHalfTon` en la entidad `charge`
   para saber por qué un ingreso fue 3900 y no el `chargeCost` normal.

## Modelo de datos (backend `pmy-api`)

### `src/entities/subsidiary.entity.ts`
Nueva columna decimal, junto a `chargeCost`:
```ts
@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.00 })
chargeCostHalfTon: number;   // costo de carga 1.5 ton; 0 = no aplica
```

### `src/entities/charge.entity.ts`
Nueva bandera de trazabilidad:
```ts
@Column({ default: false })
isHalfTon: boolean;
```

### Migración `src/database/migrations/1786000000045-AddHalfTonCharge.ts`
Defensiva (guards a `information_schema`), siguiendo el patrón del repo
(historial de `synchronize`, dev usa `DB_SYNC=true`). En `up()`:
- `ADD COLUMN subsidiary.chargeCostHalfTon DECIMAL(10,2) NOT NULL DEFAULT 0` (si falta).
- `ADD COLUMN charge.isHalfTon TINYINT(1) NOT NULL DEFAULT 0` (si falta).
- `UPDATE subsidiary SET chargeCostHalfTon = 3900 WHERE name LIKE '%Hermosillo%'`
  (seed exclusivo; solo si el valor actual es 0 para no pisar configuración manual posterior).

En `down()`: eliminar ambas columnas si existen (no revierte el seed más allá de eso).

## Backend — flujo del cargo

### Endpoint `POST /shipments/upload-charge` (`src/shipments/shipments.controller.ts`)
- Recibe un nuevo campo multipart `isHalfTon` (string `"true"`/`"false"`).
- El controlador lo parsea a booleano (mismo estilo que `notRemoveCharge`) y lo
  pasa a ambas ramas: `addChargeShipments(...)` y `processFileF2(...)`.

### `src/shipments/shipments.service.ts`
Ambos métodos (`processFileF2` ~L963, `addChargeShipments` ~L1124) reciben
`isHalfTon: boolean` como parámetro nuevo (opcional, default `false`) y:

1. Persisten `isHalfTon` en la entidad `Charge` al crearla.
2. Calculan el costo del `Income` con regla **autoritativa en backend** (no
   confía ciegamente en el front):
   ```ts
   const chargeCostToUse =
     (isHalfTon && Number(chargeSubsidiary.chargeCostHalfTon) > 0)
       ? Number(chargeSubsidiary.chargeCostHalfTon)
       : Number(chargeSubsidiary.chargeCost);
   ```
   Efecto: si una sucursal sin `chargeCostHalfTon` configurado (=0) manda
   `isHalfTon=true`, el flag es **no-op** para el cobro y cae al `chargeCost`
   normal. Hoy solo Hermosillo lo aplica → cumple "exclusivamente Hermosillo".
3. Usan `chargeCostToUse` en `cost:` del `Income` (reemplaza los dos usos de
   `chargeSubsidiary.chargeCost || 0`).

**Nota:** aunque el cobro cae al `chargeCost` normal cuando no aplica, la bandera
`isHalfTon` se persiste tal como llegó (el switch quedó activo), para trazabilidad.

## Frontend (`app-pmy`)

### `lib/types.ts`
Agregar a `Subsidiary`:
```ts
chargeCostHalfTon?: number
```

### `lib/services/shipments.ts`
`uploadF2ChargeShipments(...)` acepta un parámetro nuevo `isHalfTon: boolean`
(default `false`) y hace `formData.append("isHalfTon", isHalfTon ? "true" : "false")`.

### `components/modals/import-shipment-wizard.tsx` (paso 3)
- Nuevo estado `const [isHalfTon, setIsHalfTon] = useState(false)`.
- Resolver el objeto de la sucursal seleccionada para conocer su
  `chargeCostHalfTon` (a partir del objeto que emite `SucursalSelector` y/o del
  listado de sucursales ya disponible; guardar el objeto/valor junto a `sucursalId`).
- **Gating data-driven:** el bloque del switch de 1.5 ton solo se renderiza en el
  paso 3 cuando `selectedSubsidiary?.chargeCostHalfTon > 0`.
- Al cambiar de sucursal, si la nueva no aplica (`chargeCostHalfTon` no > 0),
  resetear `isHalfTon` a `false` para no arrastrar el flag.
- Etiqueta que indique el costo aplicado, ej.:
  "Carga 1.5 toneladas → ingreso $3,900" (mostrar el valor real de
  `chargeCostHalfTon`, formateado como moneda).
- Pasar `isHalfTon` en la llamada del paso 3:
  `uploadF2ChargeShipments(files[3], sucursalId, consNumber, date || "", notRemoveCharge, isHalfTon)`.
  (Ajustar el orden de parámetros — `onProgress` queda al final.)

## Testing / verificación

- **Backend (unit, `npm test`):** probar la regla de costo en aislamiento
  (instanciar el servicio con repos mock, estilo del repo): (a) `isHalfTon=true`
  + `chargeCostHalfTon=3900` → income 3900; (b) `isHalfTon=true` +
  `chargeCostHalfTon=0` → income = `chargeCost`; (c) `isHalfTon=false` → income
  = `chargeCost`. Verificar que `charge.isHalfTon` se guarda con el valor recibido.
- **Migración:** correr con `DB_SYNC=true` o `npm run migration:run` en dev;
  confirmar columnas nuevas y que Hermosillo quedó en 3900.
- **Frontend:** con Hermosillo seleccionada, el switch aparece; con otra
  sucursal, no. Con el switch activo, la carga F2 genera income de 3900.

## Fuera de alcance (YAGNI)

- UI de edición de `chargeCostHalfTon` por sucursal (se siembra por migración;
  editable después vía el CRUD de sucursales si se requiere, no ahora).
- Aplicar el costo 1.5 ton a otros flujos (DHL, master, etc.). Solo carga F2.

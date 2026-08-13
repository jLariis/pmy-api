# Fecha de ruta editable, flag 31.5 e ingresos "No VAN" — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir fijar la fecha de la ruta y marcarla como 31.5 al crear la salida a ruta, y que en el cierre los paquetes "No VAN" generen ingreso (validados contra FedEx) solo cuando la ruta no es 31.5.

**Architecture:** Dos columnas nuevas en `package_dispatch` (`routeDate` date, `is315` bool) fijadas al crear el despacho. El cierre ancla TODOS sus ingresos a `routeDate ?? createdAt`. Para "No VAN", el cierre re-valida cada guía contra FedEx (fuera de la transacción) y genera `Income` FedEx con costo completo + código, dejando que `charge_rule` decida qué cuenta — igual que el flujo DHL existente. Frontend: date picker + switch en el form de salida a ruta.

**Tech Stack:** NestJS + TypeORM (MySQL, migraciones) en `pmy-api`; Next.js + React + shadcn/ui en `app-pmy`.

## Global Constraints

- El esquema SIEMPRE se cambia por **migraciones**, nunca por `synchronize` (`config.ts:16`). Toda columna nueva requiere migración con guard `information_schema` (patrón de `1786000000050`).
- Migración nueva: número `1786000000051` (el 050 es el último existente).
- Columnas nuevas **nullable/defaulted** para no romper filas existentes.
- Zona horaria de anclaje de ingresos: día Hermosillo vía `hermosilloDayStartFromInstant` (ya importado en `routeclosure.service.ts`).
- Los ingresos "No VAN" se guardan SIEMPRE con costo completo + código; qué CUENTA lo decide `charge_rule`/`isCountableIncome` en lectura (NO filtrar en escritura).
- Repos: backend `C:\PMY\pmy-api`, frontend `C:\PMY\app-pmy`.
- Verificación de compilación backend: `npx tsc --noEmit`. Frontend: `npx tsc --noEmit` en `app-pmy`.
- Rutas viejas sin `routeDate` ⇒ fallback a `createdAt` (sin regresión).

---

### Task 1: Migración + entidad — `routeDate` e `is315` en `package_dispatch`

**Files:**
- Create: `src/database/migrations/1786000000051-AddRouteDateAndIs315ToDispatch.ts`
- Modify: `src/entities/package-dispatch.entity.ts` (añadir 2 columnas tras `kms`, ~L71-72)

**Interfaces:**
- Produces: `PackageDispatch.routeDate: Date | null`, `PackageDispatch.is315: boolean` (columnas MySQL `routeDate DATE NULL`, `is315 TINYINT(1) NOT NULL DEFAULT 0`).

- [ ] **Step 1: Escribir la migración**

Create `src/database/migrations/1786000000051-AddRouteDateAndIs315ToDispatch.ts`:

```ts
import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Salida a ruta: dos props nuevas fijadas al crear el despacho.
 *  - `routeDate` (DATE): día operativo de la ruta. Ancla de los ingresos del cierre
 *    (DHL, recolecciones y No VAN). Default en app = hoy; fallback a `createdAt` si null.
 *  - `is315` (bool): marca de ruta 31.5. true ⇒ los No VAN NO generan ingreso.
 *
 * DEFENSIVA: guard a information_schema por el historial de `synchronize` del proyecto.
 */
export class AddRouteDateAndIs315ToDispatch1786000000051 implements MigrationInterface {
  name = 'AddRouteDateAndIs315ToDispatch1786000000051'

  private async columnExists(qr: QueryRunner, table: string, column: string): Promise<boolean> {
    const rows = await qr.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column],
    );
    return Number(rows[0].c) > 0;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await this.columnExists(queryRunner, 'package_dispatch', 'routeDate'))) {
      await queryRunner.query(
        `ALTER TABLE \`package_dispatch\` ADD COLUMN \`routeDate\` date NULL`,
      );
    }
    if (!(await this.columnExists(queryRunner, 'package_dispatch', 'is315'))) {
      await queryRunner.query(
        `ALTER TABLE \`package_dispatch\` ADD COLUMN \`is315\` tinyint(1) NOT NULL DEFAULT 0`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await this.columnExists(queryRunner, 'package_dispatch', 'is315')) {
      await queryRunner.query(`ALTER TABLE \`package_dispatch\` DROP COLUMN \`is315\``);
    }
    if (await this.columnExists(queryRunner, 'package_dispatch', 'routeDate')) {
      await queryRunner.query(`ALTER TABLE \`package_dispatch\` DROP COLUMN \`routeDate\``);
    }
  }
}
```

- [ ] **Step 2: Añadir las columnas a la entidad**

En `src/entities/package-dispatch.entity.ts`, justo después del campo `kms` (L71-72), añadir:

```ts
  @Column({ type: 'date', nullable: true })
  routeDate: Date | null;

  @Column({ type: 'boolean', default: false })
  is315: boolean;
```

- [ ] **Step 3: Compilar**

Run: `cd /c/PMY/pmy-api && npx tsc --noEmit`
Expected: sin errores nuevos.

- [ ] **Step 4: Correr la migración**

Run: `cd /c/PMY/pmy-api && npm run migration:run`
Expected: aplica `AddRouteDateAndIs315ToDispatch1786000000051` sin error (o no-op si ya existe la columna).

- [ ] **Step 5: Commit**

```bash
git add src/database/migrations/1786000000051-AddRouteDateAndIs315ToDispatch.ts src/entities/package-dispatch.entity.ts
git commit -m "feat(dispatch): add routeDate and is315 columns to package_dispatch"
```

---

### Task 2: Backend — persistir `routeDate`/`is315` al crear la salida a ruta

**Files:**
- Modify: `src/package-dispatch/dto/create-package-dispatch.dto.ts` (añadir 2 campos)
- Modify: `src/package-dispatch/package-dispatch.service.ts:162-169` (setear en `manager.create`)

**Interfaces:**
- Consumes: `PackageDispatch.routeDate`, `PackageDispatch.is315` (Task 1).
- Produces: `CreatePackageDispatchDto.routeDate?: string` (`'YYYY-MM-DD'`), `CreatePackageDispatchDto.is315?: boolean`. Despacho creado con `routeDate` (default hoy día Hermosillo si no viene) e `is315` (default false).

- [ ] **Step 1: Ampliar el DTO**

En `src/package-dispatch/dto/create-package-dispatch.dto.ts`, añadir imports y campos. Import al inicio:

```ts
import { IsArray, IsString, IsOptional, IsBoolean, IsDateString } from "class-validator";
```

Dentro de la clase `CreatePackageDispatchDto`, tras `kms?`:

```ts
    @IsOptional()
    @IsDateString()
    routeDate?: string; // 'YYYY-MM-DD' — día operativo de la ruta (default hoy en el servicio)

    @IsOptional()
    @IsBoolean()
    is315?: boolean;
```

- [ ] **Step 2: Setear ambos campos al crear el despacho**

En `src/package-dispatch/package-dispatch.service.ts`, dentro de `create()`, en el objeto de `queryRunner.manager.create(PackageDispatch, { ... })` (L162-169), añadir estas dos props. Para el default de `routeDate` usar el inicio de día Hermosillo de hoy (import ya presente en el service o añadir `hermosilloDayStartFromInstant` desde `src/common/utils`):

```ts
      const newDispatch = queryRunner.manager.create(PackageDispatch, {
        routes: dto.routes || [],
        drivers: dto.drivers || [],
        vehicle: dto.vehicle,
        subsidiary: dto.subsidiary,
        kms: dto.kms,
        is315: dto.is315 ?? false,
        routeDate: dto.routeDate
          ? new Date(`${dto.routeDate}T07:00:00.000Z`) // 00:00 Hermosillo (UTC-7) del día elegido
          : hermosilloDayStartFromInstant(new Date()),
        createdBy: userId ? { id: userId } : null,
      });
```

Si `hermosilloDayStartFromInstant` no está importado en este archivo, añadir:
```ts
import { hermosilloDayStartFromInstant } from 'src/common/utils';
```

> Nota: `routeDate` es columna `DATE` (sin hora); MySQL guardará solo `YYYY-MM-DD`. El
> `T07:00:00Z` asegura que el día elegido no se corra por zona horaria al truncar.

- [ ] **Step 3: Compilar**

Run: `cd /c/PMY/pmy-api && npx tsc --noEmit`
Expected: sin errores nuevos.

- [ ] **Step 4: Verificación manual (smoke)**

Confirmar que un POST a `/package-dispatchs` con `{ ..., routeDate: '2026-08-10', is315: true }` crea la fila con esos valores; y que sin esos campos, `routeDate` = hoy e `is315` = 0. (Revisar en BD o log.)

- [ ] **Step 5: Commit**

```bash
git add src/package-dispatch/dto/create-package-dispatch.dto.ts src/package-dispatch/package-dispatch.service.ts
git commit -m "feat(dispatch): persist routeDate and is315 on dispatch creation"
```

---

### Task 3: Backend — resolver FedEx autoritativo para No VAN (`resolveNoVanOutcome`)

**Files:**
- Modify: `src/routeclosure/routeclosure.service.ts` (nuevo método privado + refactor de arbitraje compartido)

**Interfaces:**
- Consumes: `this.fedexService.trackPackage(trackingNumber)` (ya usado por `getBestFedexStatus`).
- Produces:
  ```ts
  interface NoVanFedexOutcome {
    trackingNumber: string;
    delivered: boolean;
    dexCode: string | null;
    resolved: boolean; // false si FedEx no devolvió datos / error
  }
  private async resolveNoVanOutcome(trackingNumber: string): Promise<NoVanFedexOutcome>
  ```

- [ ] **Step 1: Extraer el arbitraje a un helper compartido**

En `src/routeclosure/routeclosure.service.ts`, refactorizar la selección de "resultado ganador" de `getBestFedexStatus` (L503-527: reintento label-only + orden por UniqueID) a un método privado reutilizable, para no duplicar:

```ts
/** Devuelve el trackResult "ganador" de FedEx (mejor generación, con reintento label-only) o null. */
private async getWinningTrackResult(trackingNumber: string): Promise<any | null> {
  let response = await this.fedexService.trackPackage(trackingNumber);
  let results = response?.output?.completeTrackResults?.[0]?.trackResults || [];

  const isLabelOnly = results.some(r => r.latestStatusDetail?.code === 'OC' && (r.scanEvents?.length || 0) <= 1);
  if (results.length === 0 || isLabelOnly) {
    const retry = await this.fedexService.trackPackage(trackingNumber, undefined);
    results = retry?.output?.completeTrackResults?.[0]?.trackResults || results;
  }
  if (results.length === 0) return null;

  if (results.length > 1) {
    results.sort((a, b) => {
      const seqA = parseInt(a.trackingNumberInfo?.trackingNumberUniqueId?.split('~')[0] || '0');
      const seqB = parseInt(b.trackingNumberInfo?.trackingNumberUniqueId?.split('~')[0] || '0');
      return seqB - seqA;
    });
  }
  return results[0];
}
```

Luego, en `getBestFedexStatus`, reemplazar el bloque L505-527 por `const winner = await this.getWinningTrackResult(trackingNumber); if (!winner) return null;` (dejando intacto el resto del método a partir de `const scans = winner.scanEvents || [];`).

- [ ] **Step 2: Escribir `resolveNoVanOutcome`**

Añadir el método (y su interfaz encima de la clase o como tipo local). Extrae **códigos** FedEx, no el string lossy:

```ts
private async resolveNoVanOutcome(trackingNumber: string): Promise<NoVanFedexOutcome> {
  try {
    const winner = await this.getWinningTrackResult(trackingNumber);
    if (!winner) {
      return { trackingNumber, delivered: false, dexCode: null, resolved: false };
    }

    const headerCode = winner.latestStatusDetail?.code; // p.ej. 'DL' (entregado), 'DE' (excepción)
    const scans = winner.scanEvents || [];
    const latestScan = [...scans].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    )[0];

    // Entregado: código de header 'DL' o scan tipo 'DL'.
    if (headerCode === 'DL' || latestScan?.eventType === 'DL') {
      return { trackingNumber, delivered: true, dexCode: null, resolved: true };
    }

    // Excepción de entrega (DEX): extraer el código específico (03/07/08…).
    if (headerCode === 'DE' || latestScan?.eventType === 'DE') {
      const specificCode = latestScan?.exceptionCode
        || winner.latestStatusDetail?.ancillaryDetails?.[0]?.reason
        || null;
      return { trackingNumber, delivered: false, dexCode: specificCode, resolved: true };
    }

    // Otro estatus (en tránsito, en vehículo, etc.): resuelto pero sin cobro por código.
    return { trackingNumber, delivered: false, dexCode: null, resolved: true };
  } catch (error) {
    this.logger.error(`[NoVan:${trackingNumber}] resolveNoVanOutcome error: ${error.message}`);
    return { trackingNumber, delivered: false, dexCode: null, resolved: false };
  }
}
```

Y declarar la interfaz cerca del top del archivo (bajo los imports):

```ts
interface NoVanFedexOutcome {
  trackingNumber: string;
  delivered: boolean;
  dexCode: string | null;
  resolved: boolean;
}
```

- [ ] **Step 3: Compilar**

Run: `cd /c/PMY/pmy-api && npx tsc --noEmit`
Expected: sin errores nuevos.

- [ ] **Step 4: Verificación manual (smoke)**

Con el backend corriendo, llamar `POST /route-closure/validateNoVanTrackings` con una guía real conocida y confirmar que el endpoint (que sigue usando `getBestFedexStatus`) responde igual que antes (no hay regresión por el refactor del arbitraje).

- [ ] **Step 5: Commit**

```bash
git add src/routeclosure/routeclosure.service.ts
git commit -m "feat(route-closure): add authoritative FedEx outcome resolver for No VAN"
```

---

### Task 4: Backend — generar ingreso No VAN en el cierre + anclar a `routeDate`

**Files:**
- Modify: `src/routeclosure/routeclosure.service.ts` — `create()` (bloque No VAN L100-120, ancla L127, y tipo del DTO)
- Modify: `src/routeclosure/dto/create-routeclosure.dto.ts` (tipar `noVanPackages`)

**Interfaces:**
- Consumes: `resolveNoVanOutcome` (Task 3); `PackageDispatch.routeDate`/`is315` (Task 1); `subsidiary.fedexCostPackage`; `IncomeSourceType.SHIPMENT`, `IncomeStatus`, `ShipmentType.FEDEX` (ya importados).
- Produces: filas `Income` (sourceType=shipment, shipmentType=fedex) para No VAN cobrables; `create()` sigue devolviendo `savedClosure`.

- [ ] **Step 1: Tipar `noVanPackages` en el DTO**

En `src/routeclosure/dto/create-routeclosure.dto.ts`, añadir interfaz y cambiar el campo:

```ts
export interface NoVanPackageInput {
    trackingNumber: string;
    status?: string;   // estatus FedEx que ya validó el front (informativo; el backend re-valida)
    isCharge?: boolean;
}
```
y en la clase, reemplazar `noVanPackages: string[];` por:
```ts
    noVanPackages: NoVanPackageInput[];
```

> El backend ya extrae `trackingNumber` tolerando string|objeto en `create()`; este cambio
> solo corrige el tipo. No cambia el contrato de red (el front ya manda objetos).

- [ ] **Step 2: Cambiar el ancla de ingresos a `routeDate`**

En `src/routeclosure/routeclosure.service.ts`, `create()`, reemplazar la línea 127:

```ts
      const routeIncomeDate = hermosilloDayStartFromInstant(packageDispatch.createdAt ?? new Date());
```
por:
```ts
      // Ancla de TODOS los ingresos del cierre: la fecha de ruta fijada al crear la salida
      // a ruta (packageDispatch.routeDate). Fallback a createdAt para rutas viejas sin la prop.
      const routeIncomeDate = hermosilloDayStartFromInstant(
        packageDispatch.routeDate ?? packageDispatch.createdAt ?? new Date(),
      );
```

- [ ] **Step 3: Pre-resolver FedEx de los No VAN (fuera de la transacción)**

En `create()`, ANTES de `await queryRunner.startTransaction();` (L42), y tras validar que se puede acceder al dispatch... el dispatch se busca dentro de la transacción (L48). Para no reordenar la lógica de negocio, resolver los outcomes justo tras obtener `packageDispatch` y su `subsidiary` (tras L60), pero SIN bloquear si `is315`. Insertar antes del bloque "GUARDAR PAQUETES NO VAN" (antes de L100):

```ts
      // Pre-resolución FedEx de los No VAN: solo si la ruta NO es 31.5 (si es 31.5 no cobran).
      // Se hace aquí (dentro de la tx pero antes de generar ingresos) porque el dispatch se
      // carga arriba; las llamadas FedEx son de solo-lectura HTTP. Si FedEx falla, el outcome
      // sale resolved=false y esa guía simplemente no cobra (el cierre no se rompe).
      const noVanInputs = (createRouteclosureDto.noVanPackages ?? []).map(pkg =>
        typeof pkg === 'string' ? { trackingNumber: pkg } : pkg,
      );
      let noVanOutcomes: NoVanFedexOutcome[] = [];
      if (!packageDispatch.is315 && noVanInputs.length > 0) {
        noVanOutcomes = await Promise.all(
          noVanInputs.map(n => this.resolveNoVanOutcome(n.trackingNumber)),
        );
      }
```

> Aceptamos que las llamadas FedEx ocurran con la transacción abierta. Son de solo lectura
> y acotadas al número de No VAN por ruta (decenas, no miles). Si en el futuro se vuelve un
> problema de locks, mover la carga de `packageDispatch` + esta pre-resolución antes de
> `startTransaction()`.

- [ ] **Step 4: Generar los ingresos No VAN**

En `create()`, dentro del bloque `if (createRouteclosureDto.noVanPackages && ... > 0)` (L100-120), tras `await queryRunner.manager.save(ShipmentNotInFiles, noVanEntities);` (L118) y reemplazando el comentario TODO de L116, añadir:

```ts
        // Ingreso de No VAN — espejo del patrón DHL: costo completo + código; charge_rule
        // decide qué cuenta en lectura. Solo si la ruta NO es 31.5.
        if (packageDispatch.is315) {
          this.logger.log('🟡 [RouteClosure] Ruta 31.5: los No VAN NO generan ingreso.');
        } else {
          const noVanCost = packageDispatch.subsidiary?.fedexCostPackage ?? 0;
          const noVanIncomes = [];
          for (const outcome of noVanOutcomes) {
            // Sin validación FedEx (no encontrado/caído) ⇒ no se cobra.
            if (!outcome.resolved) {
              this.logger.warn(`⚠️ [RouteClosure] No VAN ${outcome.trackingNumber} sin estatus FedEx; no se cobra.`);
              continue;
            }
            // En tránsito / sin entregar ni DEX ⇒ no hay código que aplicar, no se cobra.
            if (!outcome.delivered && !outcome.dexCode) {
              continue;
            }

            const existingIncome = await queryRunner.manager.findOne(Income, {
              where: {
                trackingNumber: outcome.trackingNumber,
                sourceType: IncomeSourceType.SHIPMENT,
              },
            });
            if (existingIncome) {
              this.logger.warn(`⚠️ [RouteClosure] Ya existe ingreso (shipment) para No VAN ${outcome.trackingNumber}. Omitiendo.`);
              continue;
            }

            if (noVanCost <= 0) {
              this.logger.error(
                `❌ FINANCE_ERROR: La sucursal "${packageDispatch.subsidiary?.name ?? packageDispatch.subsidiary?.id}" tiene fedexCostPackage=0; ` +
                `el ingreso No VAN de la guía ${outcome.trackingNumber} se registró en $0.`,
              );
            }

            noVanIncomes.push(queryRunner.manager.create(Income, {
              trackingNumber: outcome.trackingNumber,
              subsidiary: packageDispatch.subsidiary,
              shipmentType: ShipmentType.FEDEX,
              cost: noVanCost,
              incomeType: outcome.delivered ? IncomeStatus.ENTREGADO : IncomeStatus.NO_ENTREGADO,
              nonDeliveryStatus: outcome.delivered ? null : outcome.dexCode,
              isGrouped: false,
              sourceType: IncomeSourceType.SHIPMENT,
              date: routeIncomeDate, // día de la RUTA
              createdById: userId ?? null,
            }));
          }

          if (noVanIncomes.length > 0) {
            await queryRunner.manager.save(Income, noVanIncomes);
            this.logger.log(`🟢 [RouteClosure] Se crearon ${noVanIncomes.length} ingresos de No VAN.`);
          }
        }
```

- [ ] **Step 5: Compilar**

Run: `cd /c/PMY/pmy-api && npx tsc --noEmit`
Expected: sin errores nuevos.

- [ ] **Step 6: Verificación manual end-to-end (backend)**

1. Crear un despacho con `is315: false` y `routeDate: '2026-08-10'`.
2. Cerrarlo con `noVanPackages: [{ trackingNumber: '<guía real entregada>' }, { trackingNumber: '<guía con DEX>' }]`.
3. Confirmar en tabla `income`: filas nuevas (sourceType=shipment, shipmentType=fedex), `date` = 2026-08-10, `cost` = `fedexCostPackage`, `incomeType`/`nonDeliveryStatus` correctos.
4. Repetir con `is315: true` ⇒ NO se crean ingresos No VAN (sí se guardan en `shipment_not_in_files`).
5. Cerrar dos veces la misma guía ⇒ el guard evita el duplicado.

- [ ] **Step 7: Commit**

```bash
git add src/routeclosure/routeclosure.service.ts src/routeclosure/dto/create-routeclosure.dto.ts
git commit -m "feat(route-closure): generate No VAN income (non-31.5) anchored to routeDate"
```

---

### Task 5: Frontend — date picker "Fecha de ruta" + switch "¿Ruta 31.5?" en la salida a ruta

**Files:**
- Modify: `C:\PMY\app-pmy\lib\types.ts:641-648` (`DispatchFormData`)
- Modify: `C:\PMY\app-pmy\lib\services\package-dispatchs.ts` (el payload ya reenvía todo `DispatchFormData`; no requiere cambio de firma, verificar)
- Modify: `C:\PMY\app-pmy\components\package-dispatch\package-dispatch-form.tsx` (estado, UI y armado del payload)

**Interfaces:**
- Consumes: backend `CreatePackageDispatchDto.routeDate`/`is315` (Task 2).
- Produces: `DispatchFormData.routeDate?: string` (`'YYYY-MM-DD'`), `DispatchFormData.is315?: boolean` incluidos en el POST de creación.

- [ ] **Step 1: Ampliar `DispatchFormData`**

En `C:\PMY\app-pmy\lib\types.ts`, dentro de `interface DispatchFormData` (L641-648), añadir:

```ts
  routeDate?: string   // 'YYYY-MM-DD' — fecha operativa de la ruta (default hoy)
  is315?: boolean      // ruta 31.5: los No VAN no generan ingreso
```

- [ ] **Step 2: Estado local para fecha y switch**

En `package-dispatch-form.tsx`, junto a `selectedKms` (L132-135), añadir dos estados con el mismo patrón `useLocalStorage`. Para la fecha, default = hoy en formato `YYYY-MM-DD`:

```ts
  const [routeDate, setRouteDate] = useLocalStorage<string>(
    'dispatch_route_date',
    new Date().toLocaleDateString('en-CA'), // 'YYYY-MM-DD' local
  );
  const [is315, setIs315] = useLocalStorage<boolean>(
    'dispatch_is315',
    false,
  );
```

Asegurar el import del Switch al inicio del archivo (si no está):
```ts
import { Switch } from "@/components/ui/switch";
```

- [ ] **Step 3: UI — añadir controles en la card "Unidad y Kilometraje"**

En `package-dispatch-form.tsx`, dentro de `<CardContent className="space-y-4">` de la card "Unidad y Kilometraje" (tras el bloque del Kilometraje, después de L837 `</div>` y antes de `</CardContent>` L838), añadir:

```tsx
              <Separator />

              <div className="space-y-3">
                <Label>Fecha de ruta</Label>
                <Input
                  type="date"
                  value={routeDate}
                  onChange={(e) => setRouteDate(e.target.value)}
                  disabled={isLoading}
                  className="w-full"
                />
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <Label htmlFor="is315-switch">¿Ruta 31.5?</Label>
                <Switch
                  id="is315-switch"
                  checked={is315}
                  onCheckedChange={setIs315}
                  disabled={isLoading}
                />
              </div>
```

(`Separator`, `Label`, `Input` ya están importados en el archivo — se usan arriba.)

- [ ] **Step 4: Incluir en el payload de creación**

En `package-dispatch-form.tsx`, en el objeto `dispatchData: DispatchFormData` (L499-509), añadir los dos campos:

```ts
      const dispatchData: DispatchFormData = {
        drivers: selectedRepartidores,
        routes: selectedRutas,
        vehicle: selectedUnidad,
        shipments: validPackages.map((p) => p.id).filter(Boolean),
        subsidiary: {
          id: selectedSubsidiaryId,
          name: selectedSubsidiaryName || "Unknown"
        },
        kms: selectedKms,
        routeDate: routeDate,
        is315: is315,
      };
```

- [ ] **Step 5: Limpiar el storage tras éxito**

En `package-dispatch-form.tsx`, en la función que limpia storage (`clearAllStorage` y el reset de estados ~L417/432), añadir el reseteo de los nuevos estados para que no queden pegados entre salidas:

```ts
      setRouteDate(new Date().toLocaleDateString('en-CA'));
      setIs315(false);
```
(Colocarlo junto a `setSelectedKms("")` donde se resetean los demás campos tras un despacho exitoso.)

- [ ] **Step 6: Compilar frontend**

Run: `cd /c/PMY/app-pmy && npx tsc --noEmit`
Expected: sin errores nuevos.

- [ ] **Step 7: Commit**

```bash
cd /c/PMY/app-pmy
git add lib/types.ts components/package-dispatch/package-dispatch-form.tsx
git commit -m "feat(dispatch): add route date picker and 31.5 switch to dispatch form"
```

---

### Task 6: Verificación end-to-end (manual, tras las 5 tareas)

**Files:** ninguno (validación).

- [ ] **Step 1: Salida a ruta con fecha y 31.5**

En la UI de salidas a ruta: crear una salida seleccionando **Fecha de ruta** = un día pasado y **¿Ruta 31.5?** = ON. Confirmar en BD que `package_dispatch.routeDate` e `is315` quedaron con esos valores.

- [ ] **Step 2: Cierre ruta 31.5 (No VAN no cobran)**

Cerrar esa ruta agregando un par de guías **No VAN**. Confirmar: se crean filas en `shipment_not_in_files`, pero **NO** hay `income` sourceType=shipment nuevos para esas guías.

- [ ] **Step 3: Salida a ruta normal (no 31.5) + cierre**

Crear otra salida con **¿Ruta 31.5?** = OFF y **Fecha de ruta** en un día concreto. Cerrarla con No VAN (una guía entregada real y una con DEX). Confirmar: se crean `income` (fedex, shipment) con `date` = la fecha de ruta, `cost` = `fedexCostPackage`, `incomeType`/`nonDeliveryStatus` correctos; y que aparecen en Finanzas › Ingresos en el bucket del día de la ruta.

- [ ] **Step 4: Regresión de ancla**

Confirmar que los ingresos de **DHL y recolecciones** de ese mismo cierre también caen en el día de `routeDate` (no en el día de cierre).

- [ ] **Step 5: Anti-duplicado**

Re-cerrar (o reintentar) la misma ruta/guía y confirmar que no se duplican ingresos No VAN.

---

## Self-review (cobertura del spec)

- Spec §4.1 (columnas `routeDate`/`is315`) → Task 1. ✅
- Spec §5.2 (persistir al crear despacho) → Task 2. ✅
- Spec §5.3 (`resolveNoVanOutcome`, refactor arbitraje) → Task 3. ✅
- Spec §5.4 (ingreso No VAN, guard, is315, FINANCE_ERROR) + ancla `routeDate` → Task 4. ✅
- Spec §5.1 (DTOs: dispatch y noVanPackages) → Task 2 (dispatch) + Task 4 Step 1 (noVan). ✅
- Spec §6 (frontend date picker + switch + payload) → Task 5. ✅
- Spec §9 criterios 1-6 → Task 6 (verificación) + compilaciones por tarea. ✅
- No se toca `isCountableIncome`/`charge_rule`/lectura (§8) — ninguna tarea los modifica. ✅

Type-consistency: `NoVanFedexOutcome` (Task 3) se consume en Task 4 con los mismos campos (`trackingNumber`, `delivered`, `dexCode`, `resolved`). `routeDate` como `'YYYY-MM-DD'` string en front (Task 5) ↔ `@IsDateString` en DTO (Task 2) ↔ columna `date` (Task 1). Consistente.

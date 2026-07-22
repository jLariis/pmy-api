# Desembarque: validación en tiempo real (uno por uno) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar la validación por lotes de desembarque (300+ guías reenviadas en cada escaneo) por validación uno-por-uno estilo inventarios, preservando el conteo por consolidado.

**Architecture:** El backend expone dos endpoints nuevos: `session-init` (universo esperado por consolidado, una sola vez) y `validate-one` (valida un tracking). El frontend siembra el conteo por consolidado al abrir y lo actualiza incrementalmente en el cliente con cada escaneo. `create()` y el batch actual no se tocan.

**Tech Stack:** NestJS + TypeORM + Jest (backend `pmy-api`); Next.js + React + axios (frontend `app-pmy`, sin framework de pruebas).

## Global Constraints

- **No tocar la persistencia ni las reglas existentes:** `create()` (transacción, estatus `EN_BODEGA`, historial `ShipmentStatus`), `getUnloadingVisibilityReport`, endpoints de reporte/upload.
- **Conservar** el batch `validate-tracking-numbers` (queda para reconciliación offline); no eliminarlo.
- **DHL-aware:** toda búsqueda de guías usa `dhlVariants` (variantes JJD/JD) y considera `dhlUniqueId`.
- **Excluir** siempre `ShipmentStatusType.DEVUELTO_A_FEDEX`.
- **Dedup por guía** conservando el registro más reciente (`removeDuplicateTNs` / orden `createdAt: 'DESC'`).
- **Regla de sucursal:** un paquete es válido solo si `subsidiary.id === subsidiaryId` (vía `validatePackageResp`).
- **Backend en español** para mensajes de usuario, igual que el código existente.
- Repos: backend en `D:\PMY\pmy-api`, frontend en `D:\PMY\app-pmy`. Rama de trabajo backend: `feat/desembarque-validacion-tiempo-real`.

---

## Task 1: Backend — endpoint `session-init` (universo esperado por consolidado)

**Files:**
- Create: `src/unloading/dto/unloading-session-init.dto.ts`
- Modify: `src/unloading/unloading.service.ts` (agregar helper `getExpectedMembersByConsolidated` y método `getUnloadingSessionInit`; reusa privados `groupByConsolidatedId`, `removeDuplicateTNs`)
- Modify: `src/unloading/unloading.controller.ts` (agregar endpoint GET)
- Test: `src/unloading/unloading-session-init.service.spec.ts`

**Interfaces:**
- Consumes: `getConsolidateToStartUnloading(subsidiaryId): Promise<ConsolidatedsDto>` (existente), `groupByConsolidatedId(items): Map<string, any[]>` (privado existente), `removeDuplicateTNs(items): any[]` (privado existente), `ShortShipmentInfo`, `ConsolidatedItemDto` (de `dto/consolidated.dto.ts`).
- Produces:
  - `getExpectedMembersByConsolidated(consolidateds: ConsolidatedItemDto[]): Promise<Map<string, ShortShipmentInfo[]>>`
  - `getUnloadingSessionInit(subsidiaryId: string): Promise<UnloadingSessionInitDto>`
  - `ConsolidatedInitItemDto { id: string; type: string; typeCode: string; numberOfPackages: number; color: string; expected: ShortShipmentInfo[] }`
  - `UnloadingSessionInitDto { airConsolidated: ConsolidatedInitItemDto[]; groundConsolidated: ConsolidatedInitItemDto[]; f2Consolidated: ConsolidatedInitItemDto[] }`
  - Endpoint `GET /unloadings/session-init/:subsidiaryId`

- [ ] **Step 1: Crear el DTO de respuesta**

Create `src/unloading/dto/unloading-session-init.dto.ts`:

```ts
import { ShortShipmentInfo } from './consolidated.dto';

export class ConsolidatedInitItemDto {
  id: string;
  type: string;
  typeCode: string;
  numberOfPackages: number;
  color: string;
  expected: ShortShipmentInfo[];
}

export class UnloadingSessionInitDto {
  airConsolidated: ConsolidatedInitItemDto[];
  groundConsolidated: ConsolidatedInitItemDto[];
  f2Consolidated: ConsolidatedInitItemDto[];
}
```

- [ ] **Step 2: Escribir el test que falla**

Create `src/unloading/unloading-session-init.service.spec.ts`:

```ts
import { UnloadingService } from './unloading.service';
import { ConsolidatedType } from 'src/common/enums/consolidated-type.enum';

function repo() {
  return { find: jest.fn(), findOne: jest.fn() };
}

function makeService(overrides: Record<string, any> = {}) {
  const deps: any = {
    unloadingRepository: repo(),
    shipmentRepository: repo(),
    chargeShipmentRepository: repo(),
    consolidatedReporsitory: repo(),
    chargeRepository: repo(),
    mailService: {},
    shipmentService: {},
    shipmentStatusRepository: repo(),
    dataSource: {},
    ...overrides,
  };
  const svc = new UnloadingService(
    deps.unloadingRepository,
    deps.shipmentRepository,
    deps.chargeShipmentRepository,
    deps.consolidatedReporsitory,
    deps.chargeRepository,
    deps.mailService,
    deps.shipmentService,
    deps.shipmentStatusRepository,
    deps.dataSource,
  );
  return { svc, deps };
}

describe('UnloadingService.getUnloadingSessionInit', () => {
  it('devuelve el universo esperado completo por consolidado', async () => {
    const consolidatedReporsitory = repo();
    consolidatedReporsitory.find.mockResolvedValue([
      { id: 'c1', type: ConsolidatedType.AEREO, numberOfPackages: 2 },
    ]);

    const shipmentRepository = repo();
    shipmentRepository.find.mockResolvedValue([
      { trackingNumber: '111', consolidatedId: 'c1', recipientName: 'Ana' },
      { trackingNumber: '222', consolidatedId: 'c1', recipientName: 'Beto' },
    ]);

    const chargeShipmentRepository = repo();
    chargeShipmentRepository.find.mockResolvedValue([]);

    const { svc } = makeService({
      consolidatedReporsitory,
      shipmentRepository,
      chargeShipmentRepository,
    });

    const result = await svc.getUnloadingSessionInit('sub-1');

    expect(result.airConsolidated).toHaveLength(1);
    expect(result.airConsolidated[0].id).toBe('c1');
    expect(result.airConsolidated[0].numberOfPackages).toBe(2);
    expect(result.airConsolidated[0].expected.map((e) => e.trackingNumber).sort())
      .toEqual(['111', '222']);
    expect(result.groundConsolidated).toHaveLength(0);
  });

  it('deduplica guías repetidas dentro del universo esperado', async () => {
    const consolidatedReporsitory = repo();
    consolidatedReporsitory.find.mockResolvedValue([
      { id: 'c1', type: ConsolidatedType.AEREO, numberOfPackages: 1 },
    ]);
    const shipmentRepository = repo();
    shipmentRepository.find.mockResolvedValue([
      { trackingNumber: '111', consolidatedId: 'c1', recipientName: 'Ana' },
      { trackingNumber: '111', consolidatedId: 'c1', recipientName: 'Ana' },
    ]);
    const chargeShipmentRepository = repo();
    chargeShipmentRepository.find.mockResolvedValue([]);

    const { svc } = makeService({ consolidatedReporsitory, shipmentRepository, chargeShipmentRepository });
    const result = await svc.getUnloadingSessionInit('sub-1');
    expect(result.airConsolidated[0].expected).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Correr el test y verlo fallar**

Run: `npm test -- unloading-session-init`
Expected: FAIL con "svc.getUnloadingSessionInit is not a function".

- [ ] **Step 4: Implementar el helper y el método de servicio**

En `src/unloading/unloading.service.ts`, agregar el import arriba (junto a los demás DTO imports):

```ts
import { ConsolidatedInitItemDto, UnloadingSessionInitDto } from './dto/unloading-session-init.dto';
```

Agregar estos dos métodos a la clase `UnloadingService` (por ejemplo justo después de `getConsolidateToStartUnloading`):

```ts
/**
 * Universo ESPERADO por consolidado (base del conteo de faltantes en el cliente).
 * Es estático durante la sesión: la membresía de un consolidado no cambia al escanear.
 * DHL-aware y con dedup por guía (registro más reciente).
 */
private async getExpectedMembersByConsolidated(
  consolidateds: ConsolidatedItemDto[],
): Promise<Map<string, ShortShipmentInfo[]>> {
  const result = new Map<string, ShortShipmentInfo[]>();

  const toShort = (item: any): ShortShipmentInfo => ({
    trackingNumber: item.trackingNumber,
    recipientName: item.recipientName,
    recipientAddress: item.recipientAddress,
    recipientPhone: item.recipientPhone,
    recipientZip: item.recipientZip,
  });

  const nonF2 = consolidateds.filter((c) => c.typeCode !== 'F2');
  const f2 = consolidateds.filter((c) => c.typeCode === 'F2');

  if (nonF2.length > 0) {
    const ids = nonF2.map((c) => c.id);
    const [shipments, charges] = await Promise.all([
      this.shipmentRepository.find({
        where: { consolidatedId: In(ids), status: Not(ShipmentStatusType.DEVUELTO_A_FEDEX) },
        select: ['trackingNumber', 'dhlUniqueId', 'consolidatedId', 'recipientName', 'recipientAddress', 'recipientPhone', 'recipientZip', 'createdAt'],
        order: { createdAt: 'DESC' },
      }),
      this.chargeShipmentRepository.find({
        where: { consolidatedId: In(ids), status: Not(ShipmentStatusType.DEVUELTO_A_FEDEX) },
        select: ['trackingNumber', 'consolidatedId', 'recipientName', 'recipientAddress', 'recipientPhone', 'recipientZip', 'createdAt'],
        order: { createdAt: 'DESC' },
      }),
    ]);

    const byShip = this.groupByConsolidatedId(shipments);
    const byCharge = this.groupByConsolidatedId(charges);

    for (const c of nonF2) {
      const all = [...(byShip.get(c.id) || []), ...(byCharge.get(c.id) || [])];
      result.set(c.id, this.removeDuplicateTNs(all).map(toShort));
    }
  }

  if (f2.length > 0) {
    const ids = f2.map((c) => c.id);
    const charges = await this.chargeShipmentRepository.find({
      where: { charge: { id: In(ids) }, status: Not(ShipmentStatusType.DEVUELTO_A_FEDEX) },
      relations: ['charge'],
      select: ['trackingNumber', 'recipientName', 'recipientAddress', 'recipientPhone', 'recipientZip', 'createdAt'],
      order: { createdAt: 'DESC' },
    });
    const byCharge = new Map<string, any[]>();
    for (const cs of charges) {
      const key = (cs as any).charge?.id;
      if (!key) continue;
      if (!byCharge.has(key)) byCharge.set(key, []);
      byCharge.get(key)!.push(cs);
    }
    for (const c of f2) {
      const all = byCharge.get(c.id) || [];
      result.set(c.id, this.removeDuplicateTNs(all).map(toShort));
    }
  }

  return result;
}

/**
 * Inicializa una sesión de desembarque: consolidados del día + su universo
 * esperado completo (para que el cliente cuente faltantes/escaneados sin volver
 * a la BD ni reenviar la lista en cada escaneo). Solo lectura.
 */
async getUnloadingSessionInit(subsidiaryId: string): Promise<UnloadingSessionInitDto> {
  const consolidateds = await this.getConsolidateToStartUnloading(subsidiaryId);
  const all: ConsolidatedItemDto[] = Object.values(consolidateds).flat();
  const expectedMap = await this.getExpectedMembersByConsolidated(all);

  const map = (arr: ConsolidatedItemDto[]): ConsolidatedInitItemDto[] =>
    arr.map((c) => ({
      id: c.id,
      type: c.type,
      typeCode: c.typeCode,
      numberOfPackages: (c as any).numberOfPackages ?? 0,
      color: c.color,
      expected: expectedMap.get(c.id) || [],
    }));

  return {
    airConsolidated: map(consolidateds.airConsolidated),
    groundConsolidated: map(consolidateds.groundConsolidated),
    f2Consolidated: map(consolidateds.f2Consolidated),
  };
}
```

- [ ] **Step 5: Correr el test y verlo pasar**

Run: `npm test -- unloading-session-init`
Expected: PASS (2 tests).

- [ ] **Step 6: Agregar el endpoint en el controller**

En `src/unloading/unloading.controller.ts`, agregar (junto a los otros GET, p.ej. después de `getConsolidatedForStartUnloading`):

```ts
@Get('session-init/:subsidiaryId')
@UseGuards(SubsidiaryScopeGuard)
getUnloadingSessionInit(@Param('subsidiaryId') subsidiaryId: string) {
  return this.unloadingService.getUnloadingSessionInit(subsidiaryId);
}
```

`SubsidiaryScopeGuard` y `UseGuards` ya están importados en este archivo.

- [ ] **Step 7: Verificar compilación**

Run: `npm run build`
Expected: build sin errores.

- [ ] **Step 8: Commit**

```bash
git add src/unloading/dto/unloading-session-init.dto.ts src/unloading/unloading.service.ts src/unloading/unloading.controller.ts src/unloading/unloading-session-init.service.spec.ts
git commit -m "feat(unloading): endpoint session-init con universo esperado por consolidado"
```

---

## Task 2: Backend — endpoint `validate-one` (valida un tracking)

**Files:**
- Create: `src/unloading/dto/validate-one.dto.ts`
- Modify: `src/unloading/unloading.service.ts` (agregar método `validateOne`; reusa `dhlVariants` y `validatePackageResp` existentes)
- Modify: `src/unloading/unloading.controller.ts` (agregar endpoint POST con `@NoAudit`)
- Test: `src/unloading/unloading-validate-one.service.spec.ts`

**Interfaces:**
- Consumes: `dhlVariants(code?: string): string[]` (privado existente), `validatePackageResp(pkg, subsidiaryId): Promise<ValidatedPackageDispatchDto>` (existente), `ShipmentStatusType.DEVUELTO_A_FEDEX`.
- Produces:
  - `validateOne(trackingNumber: string, subsidiaryId: string): Promise<ValidatedOneDto>`
  - `ValidateOneRequestDto { trackingNumber: string; subsidiaryId: string }`
  - `ValidatedOneDto { id?; trackingNumber; isValid; isCharge; reason?; consolidatedId?; recipientName?; recipientAddress?; recipientPhone?; recipientZip?; priority?; isHighValue?; payment?; commitDateTime? }` — **`id` es obligatorio para poder persistir el desembarque en el frontend (`handleSend` usa `p.id`).**
  - Endpoint `POST /unloadings/validate-one`

- [ ] **Step 1: Crear los DTOs**

Create `src/unloading/dto/validate-one.dto.ts`:

```ts
import { IsString } from 'class-validator';

export class ValidateOneRequestDto {
  @IsString()
  trackingNumber: string;

  @IsString()
  subsidiaryId: string;
}

export class ValidatedOneDto {
  id?: string;
  trackingNumber: string;
  isValid: boolean;
  isCharge: boolean;
  reason?: string;
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

- [ ] **Step 2: Escribir el test que falla**

Create `src/unloading/unloading-validate-one.service.spec.ts`:

```ts
import { UnloadingService } from './unloading.service';

function repo() {
  return { find: jest.fn(), findOne: jest.fn() };
}

function makeService(overrides: Record<string, any> = {}) {
  const deps: any = {
    unloadingRepository: repo(),
    shipmentRepository: repo(),
    chargeShipmentRepository: repo(),
    consolidatedReporsitory: repo(),
    chargeRepository: repo(),
    mailService: {},
    shipmentService: {},
    shipmentStatusRepository: repo(),
    dataSource: {},
    ...overrides,
  };
  const svc = new UnloadingService(
    deps.unloadingRepository,
    deps.shipmentRepository,
    deps.chargeShipmentRepository,
    deps.consolidatedReporsitory,
    deps.chargeRepository,
    deps.mailService,
    deps.shipmentService,
    deps.shipmentStatusRepository,
    deps.dataSource,
  );
  return { svc, deps };
}

describe('UnloadingService.validateOne', () => {
  it('valida un shipment de la sucursal correcta', async () => {
    const shipmentRepository = repo();
    shipmentRepository.findOne.mockResolvedValue({
      id: 'ship-1', trackingNumber: '111', consolidatedId: 'c1', subsidiary: { id: 'sub-1' },
      recipientName: 'Ana', priority: 'alta',
    });
    const chargeShipmentRepository = repo();
    chargeShipmentRepository.findOne.mockResolvedValue(null);

    const { svc } = makeService({ shipmentRepository, chargeShipmentRepository });
    const r = await svc.validateOne('111', 'sub-1');

    expect(r.isValid).toBe(true);
    expect(r.isCharge).toBe(false);
    expect(r.id).toBe('ship-1');
    expect(r.consolidatedId).toBe('c1');
    expect(r.recipientName).toBe('Ana');
  });

  it('marca inválido si el paquete es de otra sucursal', async () => {
    const shipmentRepository = repo();
    shipmentRepository.findOne.mockResolvedValue({
      trackingNumber: '111', consolidatedId: 'c1', subsidiary: { id: 'otra' },
    });
    const chargeShipmentRepository = repo();
    chargeShipmentRepository.findOne.mockResolvedValue(null);

    const { svc } = makeService({ shipmentRepository, chargeShipmentRepository });
    const r = await svc.validateOne('111', 'sub-1');

    expect(r.isValid).toBe(false);
    expect(r.reason).toContain('sucursal');
  });

  it('usa el chargeShipment si no hay shipment', async () => {
    const shipmentRepository = repo();
    shipmentRepository.findOne.mockResolvedValue(null);
    const chargeShipmentRepository = repo();
    chargeShipmentRepository.findOne.mockResolvedValue({
      trackingNumber: '999', consolidatedId: 'c2', subsidiary: { id: 'sub-1' },
    });

    const { svc } = makeService({ shipmentRepository, chargeShipmentRepository });
    const r = await svc.validateOne('999', 'sub-1');

    expect(r.isValid).toBe(true);
    expect(r.isCharge).toBe(true);
    expect(r.consolidatedId).toBe('c2');
  });

  it('devuelve no encontrado cuando no existe en ninguna tabla', async () => {
    const shipmentRepository = repo();
    shipmentRepository.findOne.mockResolvedValue(null);
    const chargeShipmentRepository = repo();
    chargeShipmentRepository.findOne.mockResolvedValue(null);

    const { svc } = makeService({ shipmentRepository, chargeShipmentRepository });
    const r = await svc.validateOne('000', 'sub-1');

    expect(r.isValid).toBe(false);
    expect(r.isCharge).toBe(false);
    expect(r.reason).toBeTruthy();
  });
});
```

- [ ] **Step 3: Correr el test y verlo fallar**

Run: `npm test -- unloading-validate-one`
Expected: FAIL con "svc.validateOne is not a function".

- [ ] **Step 4: Implementar `validateOne`**

En `src/unloading/unloading.service.ts`, agregar el import:

```ts
import { ValidatedOneDto } from './dto/validate-one.dto';
```

Agregar el método a la clase (por ejemplo después de `validatePackageResp`):

```ts
/**
 * Valida UN tracking (espejo de inventories.validateTrackingNumber) para el
 * escaneo en vivo de desembarque. DHL-aware, registro más reciente, regla de
 * sucursal vía validatePackageResp. No recalcula consolidados.
 */
async validateOne(trackingNumber: string, subsidiaryId: string): Promise<ValidatedOneDto> {
  const variants = this.dhlVariants(trackingNumber);

  const shipment = await this.shipmentRepository.findOne({
    where: [
      { trackingNumber: In(variants), status: Not(ShipmentStatusType.DEVUELTO_A_FEDEX) },
      { dhlUniqueId: In(variants), status: Not(ShipmentStatusType.DEVUELTO_A_FEDEX) },
    ],
    relations: ['subsidiary', 'payment'],
    order: { createdAt: 'DESC' },
  });

  const charge = shipment
    ? null
    : await this.chargeShipmentRepository.findOne({
        where: { trackingNumber: In(variants), status: Not(ShipmentStatusType.DEVUELTO_A_FEDEX) },
        relations: ['subsidiary', 'payment'],
        order: { createdAt: 'DESC' },
      });

  const record: any = shipment || charge;
  const isCharge = !shipment && !!charge;

  if (!record) {
    return {
      trackingNumber,
      isValid: false,
      isCharge: false,
      reason: 'No se encontraron datos para el tracking number en la base de datos',
    };
  }

  const validated = await this.validatePackageResp({ ...record, isValid: false }, subsidiaryId);

  return {
    id: record.id,
    trackingNumber: record.trackingNumber,
    isValid: validated.isValid,
    isCharge,
    reason: validated.reason,
    consolidatedId: record.consolidatedId,
    recipientName: record.recipientName,
    recipientAddress: record.recipientAddress,
    recipientPhone: record.recipientPhone,
    recipientZip: record.recipientZip,
    priority: record.priority,
    isHighValue: record.isHighValue,
    payment: record.payment,
    commitDateTime: record.commitDateTime,
  };
}
```

- [ ] **Step 5: Correr el test y verlo pasar**

Run: `npm test -- unloading-validate-one`
Expected: PASS (4 tests).

- [ ] **Step 6: Agregar el endpoint en el controller**

En `src/unloading/unloading.controller.ts`, agregar el import del DTO:

```ts
import { ValidateOneRequestDto } from './dto/validate-one.dto';
```

Agregar el endpoint (junto a `validate-tracking-numbers`):

```ts
@NoAudit() // Validación por escaneo: muy frecuente, no auditable.
@Post('validate-one')
validateOne(@Body() body: ValidateOneRequestDto) {
  return this.unloadingService.validateOne(body.trackingNumber, body.subsidiaryId);
}
```

`@NoAudit`, `Post` y `Body` ya están importados.

- [ ] **Step 7: Verificar compilación**

Run: `npm run build`
Expected: build sin errores.

- [ ] **Step 8: Commit**

```bash
git add src/unloading/dto/validate-one.dto.ts src/unloading/unloading.service.ts src/unloading/unloading.controller.ts src/unloading/unloading-validate-one.service.spec.ts
git commit -m "feat(unloading): endpoint validate-one para escaneo uno por uno"
```

---

## Task 3: Frontend — tipos y servicios (`session-init`, `validate-one`)

**Files:**
- Modify: `D:\PMY\app-pmy\lib\types.ts` (agregar tipos `ConsolidatedInitItem`, `UnloadingSessionInit`, `ValidatedUnloadingOne`)
- Modify: `D:\PMY\app-pmy\lib\services\unloadings.ts` (agregar wrappers y exportarlos)

**Interfaces:**
- Consumes: endpoints backend `GET /unloadings/session-init/:subsidiaryId` y `POST /unloadings/validate-one` (Task 1 y 2).
- Produces:
  - `getUnloadingSessionInit(subsidiaryId: string): Promise<UnloadingSessionInit>`
  - `validateOne(trackingNumber: string, subsidiaryId: string): Promise<ValidatedUnloadingOne>`
  - Tipos `UnloadingSessionInit`, `ConsolidatedInitItem`, `ValidatedUnloadingOne`.

- [ ] **Step 1: Agregar tipos**

En `D:\PMY\app-pmy\lib\types.ts`, agregar al final:

```ts
export interface ConsolidatedInitItem {
  id: string;
  type: string;
  typeCode: string;
  numberOfPackages: number;
  color: string;
  expected: {
    trackingNumber: string;
    recipientName?: string;
    recipientAddress?: string;
    recipientPhone?: string;
    recipientZip?: string;
  }[];
}

export interface UnloadingSessionInit {
  airConsolidated: ConsolidatedInitItem[];
  groundConsolidated: ConsolidatedInitItem[];
  f2Consolidated: ConsolidatedInitItem[];
}

export interface ValidatedUnloadingOne {
  id?: string;
  trackingNumber: string;
  isValid: boolean;
  isCharge: boolean;
  reason?: string;
  consolidatedId?: string;
  recipientName?: string;
  recipientAddress?: string;
  recipientPhone?: string;
  recipientZip?: string;
  priority?: string;
  isHighValue?: boolean;
  payment?: { type: string; amount: number };
  commitDateTime?: string;
}
```

- [ ] **Step 2: Agregar wrappers de servicio**

En `D:\PMY\app-pmy\lib\services\unloadings.ts`, agregar el import de tipos en la línea de imports de `@/lib/types`:

```ts
import { UnloadingSessionInit, ValidatedUnloadingOne } from "@/lib/types"
```

Agregar las funciones (después de `getConsolidatedsToStartUnloading`):

```ts
const getUnloadingSessionInit = async (subsidiaryId: string) => {
  const response = await axiosConfig.get<UnloadingSessionInit>(`${url}/session-init/${subsidiaryId}`);
  return response.data;
};

const validateOne = async (trackingNumber: string, subsidiaryId: string) => {
  const response = await axiosConfig.post<ValidatedUnloadingOne>(
    `${url}/validate-one`,
    { trackingNumber, subsidiaryId }
  );
  return response.data;
};
```

Agregarlas al bloque `export { ... }` al final del archivo:

```ts
export {
    getUnloadings,
    getUnloadingDetail,
    saveUnloading,
    getUnloadingById,
    validateTrackingNumbers,
    getConsolidatedsToStartUnloading,
    getUnloadingSessionInit,
    validateOne,
}
```

- [ ] **Step 3: Verificar typecheck/build**

Run: `cd /d/PMY/app-pmy && npx tsc --noEmit`
Expected: sin errores nuevos en `lib/types.ts` ni `lib/services/unloadings.ts`.

- [ ] **Step 4: Commit**

```bash
cd /d/PMY/app-pmy && git checkout -b feat/desembarque-validacion-tiempo-real && git add lib/types.ts lib/services/unloadings.ts && git commit -m "feat(desembarque): tipos y servicios session-init y validate-one"
```

---

## Task 4: Frontend — sembrar el conteo por consolidado con `session-init`

**Files:**
- Modify: `D:\PMY\app-pmy\components\operaciones\desembarque\unloading-form-wizard.tsx`

**Interfaces:**
- Consumes: `getUnloadingSessionInit` (Task 3), `UnloadingSessionInit`, `ConsolidatedInitItem`.
- Produces: `consolidatedData` ahora tipado como `UnloadingSessionInit`; `allConsolidates` usa **id real** del backend y expone `expected`; al seleccionar un consolidado, `missingPackages` se siembra con las guías esperadas.

- [ ] **Step 1: Cambiar la carga inicial a `session-init`**

En `unloading-form-wizard.tsx`:

1. En el import de servicios (línea ~12), reemplazar `getConsolidatedsToStartUnloading` por `getUnloadingSessionInit`:

```ts
import { validateTrackingNumbers, saveUnloading, uploadPDFile, getUnloadingSessionInit, validateOne } from "@/lib/services/unloadings";
```

2. En el import de tipos (línea ~13), agregar `UnloadingSessionInit`, `ConsolidatedInitItem`:

```ts
import { Consolidateds, PackageInfo, PackageInfoForUnloading, Unloading, UnloadingFormData, ValidTrackingAndConsolidateds, UnloadingSessionInit, ConsolidatedInitItem } from "@/lib/types";
```

3. Cambiar el estado `consolidatedData` (línea ~1148):

```ts
const [consolidatedData, setConsolidatedData] = useState<UnloadingSessionInit>();
```

4. Cambiar el efecto de carga (línea ~1232) para llamar al nuevo servicio:

```ts
useEffect(() => {
  const loadConsolidates = async () => {
    if (!user?.subsidiary?.id) return;

    setLoadingConsolidates(true);
    try {
      const data = await getUnloadingSessionInit(user.subsidiary.id);
      setConsolidatedData(data);
    } catch (error) {
      console.error("Error loading consolidates:", error);
      toast({
        title: "Error",
        description: "No se pudieron cargar los consolidados",
        variant: "destructive",
      });
    } finally {
      setLoadingConsolidates(false);
    }
  };

  loadConsolidates();
}, [user?.subsidiary?.id, toast]);
```

- [ ] **Step 2: Usar el id real y exponer `expected` en `allConsolidates`**

Ampliar la interfaz `ConsolidateItem` (línea ~107) para incluir `typeCode` y `expected`:

```ts
interface ConsolidateItem {
  id: string;
  type: string;
  typeCode: string;
  numberOfPackages: number;
  added: string[];
  notFound: string[];
  expected: { trackingNumber: string }[];
}
```

Reemplazar el `useMemo` de `allConsolidates` (línea ~1256) por una versión que usa el **id real** y mapea `expected`:

```ts
const allConsolidates = useMemo(() => {
  if (!consolidatedData) return [];

  const toItem = (item: ConsolidatedInitItem): ConsolidateItem => ({
    id: item.id,
    type: item.type,
    typeCode: item.typeCode,
    numberOfPackages: item.numberOfPackages,
    added: [],
    notFound: item.expected.map((e) => e.trackingNumber),
    expected: item.expected,
  });

  return [
    ...(consolidatedData.airConsolidated?.map(toItem) ?? []),
    ...(consolidatedData.groundConsolidated?.map(toItem) ?? []),
    ...(consolidatedData.f2Consolidated?.map(toItem) ?? []),
  ];
}, [consolidatedData]);
```

- [ ] **Step 3: Sembrar `missingPackages` al seleccionar un consolidado**

En `Step1SelectConsolidates`, la función `toggleConsolidate` (línea ~379) ya construye `SelectedConsolidate` a partir de `consolidate.notFound`. Como ahora `notFound` = universo esperado, `missingPackages` queda sembrado correctamente. Verificar que el bloque `newSelected` use `consolidate.notFound` para `missingPackages` (ya lo hace):

```ts
const newSelected: SelectedConsolidate = {
  id: consolidate.id,
  type: consolidate.type,
  totalPackages: consolidate.numberOfPackages,
  added: [],
  notFound: consolidate.notFound || [],
  scannedPackages: [],
  missingPackages: consolidate.notFound || []
};
```

Ningún cambio de código adicional aquí; confirmar que compila con la nueva `ConsolidateItem`.

- [ ] **Step 4: Verificar typecheck/build**

Run: `cd /d/PMY/app-pmy && npx tsc --noEmit`
Expected: sin errores en `unloading-form-wizard.tsx`.

- [ ] **Step 5: Verificar en el navegador (manual)**

Usar el skill `run` para levantar app-pmy. Abrir el módulo de desembarque, verificar que:
- Los consolidados cargan con su total y con "faltantes" = total esperado (no 0) antes de escanear.
- La red muestra una sola llamada `GET /unloadings/session-init/...` al abrir.

- [ ] **Step 6: Commit**

```bash
cd /d/PMY/app-pmy && git add components/operaciones/desembarque/unloading-form-wizard.tsx && git commit -m "feat(desembarque): sembrar conteo por consolidado con session-init (id real + expected)"
```

---

## Task 5: Frontend — escaneo uno por uno con `validate-one` y conteo incremental

**Files:**
- Modify: `D:\PMY\app-pmy\components\operaciones\desembarque\unloading-form-wizard.tsx`

**Interfaces:**
- Consumes: `validateOne` (Task 3), `ValidatedUnloadingOne`, estado sembrado en Task 4 (`selectedConsolidates` con `missingPackages`).
- Produces: `handleValidatePackages` valida solo las guías **nuevas** una por una vía `validate-one`; el conteo por consolidado se actualiza por `consolidatedId`.

- [ ] **Step 1: Reescribir `handleValidatePackages` para validar uno por uno**

Reemplazar el cuerpo de `handleValidatePackages` (línea ~1357) por esta versión. Valida solo trackings nuevos, uno por uno, y asigna por `consolidatedId`:

```ts
const handleValidatePackages = async () => {
  if (isLoading || isValidationPackages) return;

  if (!selectedSubsidiaryId) {
    toast({
      title: "Error",
      description: "Selecciona una sucursal antes de validar.",
      variant: "destructive",
    });
    setIsValidationPackages(false);
    return;
  }

  const trackingNumbers = scannedPackages.map((pkg) => pkg.trackingNumber);
  const validNumbers = trackingNumbers.filter((tn) => /^\d{12}$/.test(tn));
  const invalidNumbers = trackingNumbers.filter((tn) => !/^\d{12}$/.test(tn));

  // Solo las guías que aún no están en shipments (nuevas).
  const newNumbers = validNumbers.filter(
    (tn) => !shipments.some((p) => p.trackingNumber === tn)
  );

  if (newNumbers.length === 0) {
    setMissingTrackings(invalidNumbers);
    return;
  }

  setIsLoading(true);
  setProgress(0);

  try {
    // Validación uno por uno (como inventarios).
    const results: ValidatedUnloadingOne[] = [];
    for (const tn of newNumbers) {
      const r = await validateOne(tn, selectedSubsidiaryId);
      results.push(r);
    }

    const newValidShipments = results.map((r) => ({
      ...r,
      id: r.id,
    })) as unknown as PackageInfoForUnloading[];

    if (barScannerInputRef.current && barScannerInputRef.current.updateValidatedPackages) {
      barScannerInputRef.current.updateValidatedPackages(newValidShipments);
    }

    // Actualizar conteo por consolidado usando el consolidatedId real.
    newValidShipments.forEach((packageInfo) => {
      const cid = (packageInfo as any).consolidatedId;
      if (!packageInfo.isValid || !cid) return;

      setSelectedConsolidates((prev) =>
        prev.map((consolidate) => {
          if (consolidate.id !== cid) return consolidate;
          return {
            ...consolidate,
            scannedPackages: [
              ...consolidate.scannedPackages,
              { ...packageInfo, consolidateId: consolidate.id },
            ],
            missingPackages: consolidate.missingPackages.filter(
              (tracking) => tracking !== packageInfo.trackingNumber
            ),
          };
        })
      );
    });

    setShipments((prev) => [...prev, ...newValidShipments]);
    setMissingTrackings(invalidNumbers);
    setUnScannedTrackings([]);

    const todayExpiringPackages: ExpiringPackage[] = newValidShipments
      .filter((pkg) => pkg.isValid && pkg.commitDateTime && checkPackageExpiration(pkg))
      .map((pkg) => ({
        trackingNumber: pkg.trackingNumber,
        recipientName: pkg.recipientName || undefined,
        recipientAddress: pkg.recipientAddress || undefined,
        commitDateTime: pkg.commitDateTime || undefined,
        daysUntilExpiration: pkg.commitDateTime ? getDaysUntilExpiration(pkg.commitDateTime) : 0,
        priority: pkg.priority || undefined,
      }));

    if (todayExpiringPackages.length > 0) {
      setExpiringPackages(todayExpiringPackages);
      setCurrentExpiringIndex(0);
      setExpirationAlertOpen(true);
    }

    const validCount = newValidShipments.filter((p) => p.isValid).length;
    const invalidCount = newValidShipments.filter((p) => !p.isValid).length;

    toast({
      title: "Validación completada",
      description: `Se agregaron ${validCount} paquetes válidos. Paquetes inválidos: ${
        invalidCount + invalidNumbers.length
      }`,
    });
  } catch (error) {
    console.error("Error validating packages:", error);

    if (!isOnline) {
      const offlinePackages: PackageInfoForUnloading[] = newNumbers.map((tn) => ({
        id: `offline-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        trackingNumber: tn,
        isValid: false,
        reason: "Sin conexión - validar cuando se restablezca internet",
        isOffline: true,
        createdAt: new Date(),
      } as PackageInfoForUnloading));

      setShipments((prev) => [...prev, ...offlinePackages]);
      setMissingTrackings(invalidNumbers);

      toast({
        title: "Modo offline activado",
        description: `Se guardaron ${newNumbers.length} paquetes localmente. Se validarán cuando se recupere la conexión.`,
      });
    } else {
      toast({
        title: "Error",
        description: "Hubo un problema al validar los paquetes.",
        variant: "destructive",
      });
    }
  } finally {
    setIsValidationPackages(false);
    setProgress(0);
    setIsLoading(false);
  }
};
```

- [ ] **Step 2: Confirmar que la revalidación offline usa `validateOne`**

En el `useEffect` de revalidación offline (línea ~1178), reemplazar la llamada al batch por `validateOne` por paquete:

```ts
offlinePackages.forEach(async (pkg) => {
  try {
    const validated = await validateOne(pkg.trackingNumber, selectedSubsidiaryId);
    setShipments((prev) =>
      prev.map((prevPkg) =>
        prevPkg.trackingNumber === pkg.trackingNumber
          ? ({ ...validated, id: validated.id } as unknown as PackageInfoForUnloading)
          : prevPkg
      )
    );
  } catch (error) {
    console.error("Error revalidando paquete offline:", error);
  }
});
```

- [ ] **Step 3: Verificar typecheck/build**

Run: `cd /d/PMY/app-pmy && npx tsc --noEmit`
Expected: sin errores en `unloading-form-wizard.tsx`.

- [ ] **Step 4: Verificar en el navegador (manual)**

Usar el skill `run` para levantar app-pmy. En el módulo de desembarque:
- Seleccionar consolidado(s) → escanear varias guías.
- Confirmar en la pestaña de red que cada escaneo dispara **una** llamada `POST /unloadings/validate-one` con un solo tracking (no la lista completa).
- Confirmar que el contador "escaneados" sube y "faltantes" baja por consolidado en vivo.
- Escanear una guía repetida → no dispara nueva llamada (ya está en `shipments`).
- Completar el flujo hasta el Paso 3 y "Enviar y Finalizar" → verificar que `POST /unloadings` (create) se llama igual que antes y el desembarque se guarda.

- [ ] **Step 5: Commit**

```bash
cd /d/PMY/app-pmy && git add components/operaciones/desembarque/unloading-form-wizard.tsx && git commit -m "feat(desembarque): escaneo uno por uno con validate-one y conteo incremental"
```

---

## Notas de verificación final (cross-repo)

- Backend: `npm test -- unloading` (todos los specs de unloading en verde) y `npm run build`.
- Frontend: `npx tsc --noEmit` limpio y verificación manual en navegador de los tres criterios: una llamada `session-init` al abrir, una `validate-one` por escaneo, y `create()` intacto al finalizar.
- Criterios de aceptación del spec (`docs/superpowers/specs/2026-07-17-desembarque-validacion-tiempo-real-design.md`) 1–6 cubiertos por Tasks 1–5.

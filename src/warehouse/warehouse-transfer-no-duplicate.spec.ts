// src/warehouse/warehouse-transfer-no-duplicate.spec.ts
//
// Verificación (guardia de regresión): el proceso de TRASPASO debe MOVER los
// paquetes (UPDATE de subsidiary + status) y NUNCA insertar/guardar filas nuevas
// de Shipment/ChargeShipment (eso duplicaría el paquete en la BD).
//
// `createTransfer` no usa `this`, así que lo invocamos aislado con un queryRunner
// simulado que registra cada operación contra el manager.
import { WarehouseService } from './warehouse.service';
import { ShipmentStatusType } from 'src/common/enums';

function entityName(e: any): string {
  return typeof e === 'function' ? e.name : String(e?.constructor?.name ?? e);
}

function makeRecordingQueryRunner() {
  const operations: { type: string; entity?: string; payload?: any }[] = [];
  let lastSet: any;
  let lastIds: any;

  const qb: any = {
    update(entity: any) {
      operations.push({ type: 'update', entity: entityName(entity) });
      return qb;
    },
    set(v: any) { lastSet = v; return qb; },
    whereInIds(ids: any) { lastIds = ids; return qb; },
    async execute() { return {}; },
  };

  const manager: any = {
    createQueryBuilder: () => qb,
    create: (entity: any, data: any) => ({ __entity: entityName(entity), ...data }),
    // Cualquier save/insert/update a nivel manager queda registrado.
    save: async (entity: any, data: any) => {
      operations.push({ type: 'save', entity: entityName(entity), payload: data });
      return data;
    },
    insert: async (entity: any, data: any) => {
      operations.push({ type: 'insert', entity: entityName(entity), payload: data });
      return {};
    },
    update: async (entity: any, _crit: any, data: any) => {
      operations.push({ type: 'managerUpdate', entity: entityName(entity), payload: data });
      return {};
    },
  };

  return {
    queryRunner: { manager } as any,
    operations,
    getLastSet: () => lastSet,
    getLastIds: () => lastIds,
  };
}

const callCreateTransfer = (dto: any, queryRunner: any) =>
  (WarehouseService.prototype as any).createTransfer.call({}, dto, queryRunner);

describe('createTransfer (traspaso) — no duplica shipments', () => {
  const dto = {
    destinationId: 'dest-1',
    shipments: [
      { id: 's1', isCharge: false },
      { id: 's2', isCharge: false },
      { id: 'c1', isCharge: true },
    ],
  };

  it('NUNCA hace save/insert de Shipment ni ChargeShipment (solo UPDATE)', async () => {
    const { queryRunner, operations } = makeRecordingQueryRunner();

    await callCreateTransfer(dto, queryRunner);

    const shipmentWrites = operations.filter(
      (o) =>
        (o.type === 'save' || o.type === 'insert') &&
        (o.entity === 'Shipment' || o.entity === 'ChargeShipment'),
    );
    expect(shipmentWrites).toHaveLength(0);
  });

  it('mueve vía UPDATE de Shipment y ChargeShipment a la sucursal destino', async () => {
    const { queryRunner, operations, getLastSet } = makeRecordingQueryRunner();

    await callCreateTransfer(dto, queryRunner);

    const updatedEntities = operations
      .filter((o) => o.type === 'update')
      .map((o) => o.entity)
      .sort();
    expect(updatedEntities).toEqual(['ChargeShipment', 'Shipment']);

    // El UPDATE cambia sucursal (mover) + estatus, no crea nada.
    expect(getLastSet().subsidiary).toEqual({ id: 'dest-1' });
    expect(getLastSet().status).toBe(ShipmentStatusType.EN_RUTA);
  });

  it('los únicos save son de historial (ShipmentStatus), no de paquetes', async () => {
    const { queryRunner, operations } = makeRecordingQueryRunner();

    await callCreateTransfer(dto, queryRunner);

    const saves = operations.filter((o) => o.type === 'save');
    expect(saves.length).toBeGreaterThan(0);
    expect(saves.every((s) => s.entity === 'ShipmentStatus')).toBe(true);
  });

  it('reporta los paquetes movidos sin crear filas nuevas', async () => {
    const { queryRunner } = makeRecordingQueryRunner();
    const result = await callCreateTransfer(dto, queryRunner);
    expect(result.transferredPackages).toBe(3);
    expect(result.destination).toBe('dest-1');
  });

  it('gestiona solo normales o solo carga sin insertar shipments', async () => {
    const onlyNormal = { destinationId: 'd', shipments: [{ id: 'a', isCharge: false }] };
    const { queryRunner, operations } = makeRecordingQueryRunner();
    await callCreateTransfer(onlyNormal, queryRunner);
    expect(
      operations.filter(
        (o) => (o.type === 'save' || o.type === 'insert') && o.entity !== 'ShipmentStatus',
      ),
    ).toHaveLength(0);
    // Solo se actualiza Shipment (no hay carga).
    expect(operations.filter((o) => o.type === 'update').map((o) => o.entity)).toEqual(['Shipment']);
  });
});

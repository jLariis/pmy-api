// p-limit es ESM puro y jest no transforma node_modules; lo stubeamos para que
// corra la tarea inline (shipments.service lo importa a nivel de módulo).
jest.mock('p-limit', () => ({ __esModule: true, default: () => (fn: any) => fn() }));

import { ShipmentsService } from './shipments.service';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';

/**
 * Blindaje de eventos FedEx PRE-REGISTRO del mismo día (Hermosillo/Cabos) +
 * sincronización de commitDateTime en "cambio de fecha solicitada" (DEX 17/84).
 *
 * Estos tests ejercen los métodos REALES `processMasterFedexUpdate` /
 * `processChargeFedexUpdate` con toda la I/O mockeada (QueryRunner, prefetch,
 * generateIncomes). Se valida QUÉ eventos entran al pipeline (historial/ingreso)
 * y cómo queda el estatus/commitDateTime, sin tocar la lógica del servicio.
 *
 * Zona operativa = America/Hermosillo (UTC-7, sin horario de verano):
 *   local 09:00 del 2026-08-16  ==  16:00Z del 2026-08-16
 *   local 12:00 del 2026-08-16  ==  19:00Z del 2026-08-16
 */

// Instante UTC a partir de una hora LOCAL de Hermosillo (UTC-7).
const her = (isoLocal: string) => new Date(`${isoLocal}-07:00`);

type Scenario = {
  allowPreReg: boolean;
  trackExternalDelivery?: boolean;
  status?: ShipmentStatusType;          // estatus actual del shipment
  createdAt: Date;
  commitDateTime?: Date;
  existingHistory: { status: any; timestamp: Date; exceptionCode: string }[];
  scanEvents: { date: Date; exceptionCode?: string; derivedStatusCode?: string; eventType?: string }[];
  dateAndTimes?: { type: string; dateTime: string }[];
  lsdHeader?: any;
  existing08Count?: number;
  incomeExists?: boolean;
};

function buildHarness(s: Scenario, kind: 'master' | 'charge' = 'master') {
  const subsidiary = {
    id: 'sub-1',
    name: 'Hermosillo',
    isWarehouse: false,
    allowSameDayPreRegistrationFedexEvents: s.allowPreReg,
    trackFedexExternalDelivery: !!s.trackExternalDelivery,
    forceFedexStatusOverride: false,
  };

  const record: any = {
    id: 'ship-1',
    trackingNumber: 'TRK1',
    status: s.status ?? ShipmentStatusType.EN_RUTA,
    subsidiary,
    createdAt: s.createdAt,
    commitDateTime: s.commitDateTime ?? her('2026-08-16T18:00:00'),
    fedexUniqueId: 'u1',
    carrierCode: 'FDXG',
    receivedByName: null,
  };

  const trackResult = {
    scanEvents: s.scanEvents.map((e) => ({
      date: e.date.toISOString(),
      exceptionCode: e.exceptionCode ?? '',
      derivedStatusCode: e.derivedStatusCode ?? '',
      eventType: e.eventType ?? 'DE',
      eventDescription: 'FedEx Scan',
    })),
    latestStatusDetail: s.lsdHeader ?? { code: 'DE', derivedCode: 'DE', ancillaryDetails: [] },
    trackingNumberInfo: { trackingNumberUniqueId: '1~u1', carrierCode: 'FDXG' },
    dateAndTimes: s.dateAndTimes ?? [],
    deliveryDetails: {},
  };

  const createdHistory: any[] = [];
  const manager = {
    find: jest.fn().mockResolvedValue([record]),
    query: jest.fn().mockResolvedValue(s.existingHistory),
    count: jest.fn().mockResolvedValue(s.existing08Count ?? 0),
    findOne: jest.fn().mockResolvedValue(s.incomeExists ? { id: 'inc' } : null),
    create: jest.fn((_entity: any, data: any) => { createdHistory.push(data); return data; }),
    save: jest.fn(async (a: any, b: any) => b ?? a),
  };

  const queryRunner = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    isTransactionActive: true,
    manager,
  };

  const svc = Object.create(ShipmentsService.prototype) as any;
  svc.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  svc.SUBSIDIARY_CONFIG = {};
  svc.dataSource = { createQueryRunner: () => queryRunner };
  svc.fedexService = { trackPackage: jest.fn() };
  svc.generateIncomes = jest.fn().mockResolvedValue(undefined);
  svc.writeFedexDeadLetter = jest.fn().mockResolvedValue(undefined);
  svc.prefetchFedexBatch = jest.fn().mockResolvedValue({
    map: new Map([['TRK1', [trackResult]]]),
    networkErrors: 0,
  });

  return { svc, record, createdHistory, generateIncomes: svc.generateIncomes, kind };
}

async function runMaster(s: Scenario) {
  const h = buildHarness(s, 'master');
  await h.svc.processMasterFedexUpdate([{ id: 'ship-1', trackingNumber: 'TRK1' }]);
  return h;
}

// Códigos de excepción efectivamente escritos en historial (los que entraron al pipeline).
const processedCodes = (createdHistory: any[]) =>
  createdHistory.map((x) => (x.exceptionCode || '').trim());

describe('processMasterFedexUpdate — blindaje pre-registro (mismo día)', () => {
  const createdAt = her('2026-08-16T12:00:00');            // 12:00 local
  const enRuta = { status: ShipmentStatusType.EN_RUTA, timestamp: her('2026-08-16T13:30:00'), exceptionCode: '' };

  it('C) Hermosillo + DEX07 pre-registro del MISMO día → historial + ingreso 07 Y estatus pasa a RECHAZADO (destraba cierre/devoluciones)', async () => {
    const { createdHistory, generateIncomes, record } = await runMaster({
      allowPreReg: true,
      createdAt,
      existingHistory: [enRuta],
      // DEX07 a las 09:00 local: ANTES de createdAt (12:00), mismo día calendario.
      scanEvents: [{ date: her('2026-08-16T09:00:00'), exceptionCode: '07' }],
    });

    expect(processedCodes(createdHistory)).toContain('07');           // entró al historial
    expect(generateIncomes).toHaveBeenCalledTimes(1);                 // ingreso 07 generado
    // El EN_RUTA queda en historial, pero el estatus ACTUAL refleja el DEX → el cierre
    // de ruta y las devoluciones (que leen shipment.status) lo ven como "no entregado".
    expect(record.status).toBe(ShipmentStatusType.RECHAZADO);
  });

  it('C.2) Hermosillo + DEX08 pre-registro → estatus pasa a CLIENTE_NO_DISPONIBLE', async () => {
    const { record } = await runMaster({
      allowPreReg: true,
      createdAt,
      existingHistory: [enRuta],
      scanEvents: [{ date: her('2026-08-16T09:00:00'), exceptionCode: '08' }],
    });
    expect(record.status).toBe(ShipmentStatusType.CLIENTE_NO_DISPONIBLE);
  });

  it('C.3) Sucursal NORMAL + DEX pre-registro del mismo día → NO cambia el estatus (queda EN_RUTA)', async () => {
    const { record } = await runMaster({
      allowPreReg: false, // solo Hermosillo aplica el override de estatus
      createdAt,
      existingHistory: [enRuta],
      scanEvents: [{ date: her('2026-08-16T09:00:00'), exceptionCode: '07' }],
    });
    expect(record.status).toBe(ShipmentStatusType.EN_RUTA);
  });

  it('E) Hermosillo + DEX07 del DÍA ANTERIOR → se ignora (no historial, no ingreso)', async () => {
    const { createdHistory, generateIncomes } = await runMaster({
      allowPreReg: true,
      createdAt,
      existingHistory: [enRuta],
      // DEX07 el 2026-08-15 (día anterior a createdAt) → excepción NO aplica.
      scanEvents: [{ date: her('2026-08-15T09:00:00'), exceptionCode: '07' }],
    });

    expect(processedCodes(createdHistory)).not.toContain('07');
    expect(generateIncomes).not.toHaveBeenCalled();
  });

  it('CASO 4) Sucursal NORMAL + DEX anterior a createdAt (mismo día) → se ignora', async () => {
    const { createdHistory, generateIncomes } = await runMaster({
      allowPreReg: false, // sucursal normal
      createdAt: her('2026-08-16T10:00:00'),
      existingHistory: [{ status: ShipmentStatusType.EN_RUTA, timestamp: her('2026-08-16T11:00:00'), exceptionCode: '' }],
      scanEvents: [{ date: her('2026-08-16T08:00:00'), exceptionCode: '07' }], // 08:00 < createdAt 10:00
    });

    expect(processedCodes(createdHistory)).not.toContain('07');
    expect(generateIncomes).not.toHaveBeenCalled();
  });

  it('B) Sucursal NORMAL + DEX posterior a la operación → se procesa normal', async () => {
    const { createdHistory, generateIncomes } = await runMaster({
      allowPreReg: false,
      createdAt: her('2026-08-16T10:00:00'),
      existingHistory: [{ status: ShipmentStatusType.EN_RUTA, timestamp: her('2026-08-16T11:00:00'), exceptionCode: '' }],
      scanEvents: [{ date: her('2026-08-16T14:00:00'), exceptionCode: '07' }], // posterior
    });

    expect(processedCodes(createdHistory)).toContain('07');
    expect(generateIncomes).toHaveBeenCalledTimes(1);
  });

  it('J) Evento ya registrado (misma huella) → no se duplica', async () => {
    const dupDate = her('2026-08-16T14:00:00');
    const { createdHistory, generateIncomes } = await runMaster({
      allowPreReg: false,
      createdAt: her('2026-08-16T10:00:00'),
      existingHistory: [
        { status: ShipmentStatusType.EN_RUTA, timestamp: her('2026-08-16T11:00:00'), exceptionCode: '' },
        // Huella idéntica (timestamp + exceptionCode) ya en shipment_status.
        { status: ShipmentStatusType.RECHAZADO, timestamp: dupDate, exceptionCode: '07' },
      ],
      scanEvents: [{ date: dupDate, exceptionCode: '07' }],
    });

    expect(createdHistory).toHaveLength(0);
    expect(generateIncomes).not.toHaveBeenCalled();
  });

  it('K) Estatus terminal (ENTREGADO) → candado, no regresa a operativo', async () => {
    const { record } = await runMaster({
      allowPreReg: true,
      status: ShipmentStatusType.ENTREGADO,
      createdAt,
      existingHistory: [enRuta],
      scanEvents: [{ date: her('2026-08-16T09:00:00'), exceptionCode: '07' }],
    });

    expect(record.status).toBe(ShipmentStatusType.ENTREGADO); // sigue terminal
  });
});

describe('processMasterFedexUpdate — commitDateTime en cambio de fecha (17/84), TODAS las sucursales', () => {
  const NEW_COMMIT = '2026-08-20T22:00:00.000Z';

  it('DEX17 (cambio de fecha) actualiza commitDateTime con la nueva fecha de FedEx — sucursal NORMAL', async () => {
    const { record } = await runMaster({
      allowPreReg: false, // sucursal normal → confirma que aplica a todas
      createdAt: her('2026-08-16T10:00:00'),
      commitDateTime: her('2026-08-16T18:00:00'),
      existingHistory: [{ status: ShipmentStatusType.EN_RUTA, timestamp: her('2026-08-16T11:00:00'), exceptionCode: '' }],
      scanEvents: [{ date: her('2026-08-16T14:00:00'), exceptionCode: '17' }], // cambio de fecha, posterior
      dateAndTimes: [{ type: 'ESTIMATED_DELIVERY', dateTime: NEW_COMMIT }],
    });

    expect(new Date(record.commitDateTime).toISOString()).toBe(NEW_COMMIT);
  });

  it('sin evento de cambio de fecha → commitDateTime NO se toca', async () => {
    const original = her('2026-08-16T18:00:00');
    const { record } = await runMaster({
      allowPreReg: false,
      createdAt: her('2026-08-16T10:00:00'),
      commitDateTime: original,
      existingHistory: [{ status: ShipmentStatusType.EN_RUTA, timestamp: her('2026-08-16T11:00:00'), exceptionCode: '' }],
      scanEvents: [{ date: her('2026-08-16T14:00:00'), exceptionCode: '07' }], // NO es cambio de fecha
      dateAndTimes: [{ type: 'ESTIMATED_DELIVERY', dateTime: NEW_COMMIT }],
    });

    expect(new Date(record.commitDateTime).getTime()).toBe(original.getTime());
  });

  it('cambio de fecha en shipment TERMINAL → candado: no se actualiza commitDateTime', async () => {
    const original = her('2026-08-16T18:00:00');
    const { record } = await runMaster({
      allowPreReg: false,
      status: ShipmentStatusType.ENTREGADO,
      createdAt: her('2026-08-16T10:00:00'),
      commitDateTime: original,
      existingHistory: [{ status: ShipmentStatusType.EN_RUTA, timestamp: her('2026-08-16T11:00:00'), exceptionCode: '' }],
      scanEvents: [{ date: her('2026-08-16T14:00:00'), exceptionCode: '17' }],
      dateAndTimes: [{ type: 'ESTIMATED_DELIVERY', dateTime: NEW_COMMIT }],
    });

    expect(new Date(record.commitDateTime).getTime()).toBe(original.getTime());
  });
});

describe('processChargeFedexUpdate — espejo del blindaje y commitDateTime', () => {
  async function runCharge(s: Scenario, subName = 'Cabo San Lucas') {
    const h = buildHarness(s, 'charge');
    h.record.subsidiary.name = subName;
    await h.svc.processChargeFedexUpdate([{ id: 'ship-1', trackingNumber: 'TRK1' }]);
    return h;
  }

  it('Cabos + DEX pre-registro del mismo día → entra al historial (las cargas no cobran, pero sí historian)', async () => {
    const { createdHistory } = await runCharge({
      allowPreReg: true,
      createdAt: her('2026-08-16T12:00:00'),
      existingHistory: [{ status: ShipmentStatusType.EN_RUTA, timestamp: her('2026-08-16T13:30:00'), exceptionCode: '' }],
      scanEvents: [{ date: her('2026-08-16T09:00:00'), exceptionCode: '08' }],
    });

    expect(processedCodes(createdHistory)).toContain('08');
  });

  it('Carga con DEX17 → commitDateTime se actualiza (todas las sucursales)', async () => {
    const NEW_COMMIT = '2026-08-21T22:00:00.000Z';
    const { record } = await runCharge({
      allowPreReg: false,
      createdAt: her('2026-08-16T10:00:00'),
      commitDateTime: her('2026-08-16T18:00:00'),
      existingHistory: [{ status: ShipmentStatusType.EN_RUTA, timestamp: her('2026-08-16T11:00:00'), exceptionCode: '' }],
      scanEvents: [{ date: her('2026-08-16T14:00:00'), exceptionCode: '17' }],
      dateAndTimes: [{ type: 'ESTIMATED_DELIVERY', dateTime: NEW_COMMIT }],
    }, 'Obregón');

    expect(new Date(record.commitDateTime).toISOString()).toBe(NEW_COMMIT);
  });
});

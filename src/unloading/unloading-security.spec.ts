// p-limit es ESM y rompe el parseo de jest al entrar por shipments.service.
jest.mock('p-limit', () => ({
  __esModule: true,
  default: () => (fn: any) => fn(),
}));

import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UnloadingService } from './unloading.service';
import { UnloadingController } from './unloading.controller';
import {
  assertSubsidiaryAccess,
  canAccessSubsidiary,
  finalStatusReason,
  looksLikePdf,
  looksLikeXlsx,
  normalizeClientRequestId,
  safeAttachmentName,
} from './unloading-access.util';

function repo() {
  return { find: jest.fn(), findOne: jest.fn() };
}

/** QueryRunner falso: guarda lo que se actualiza para revisarlo en las pruebas. */
function fakeQueryRunner(data: { shipments?: any[]; charges?: any[] }) {
  const updates: { ids: string[] }[] = [];
  const manager = {
    find: jest.fn(async (entity: any) => (entity?.name === 'Shipment' ? data.shipments ?? [] : data.charges ?? [])),
    create: jest.fn((_e: any, v: any) => v),
    save: jest.fn(async (a: any, b?: any) => (b ?? { ...a, id: 'unl-1', trackingNumber: '123456789012' })),
    update: jest.fn(async (_e: any, where: any) => updates.push({ ids: where.id._value ?? where.id.value ?? [] })),
  };
  const qr = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    manager,
  };
  return { qr, updates, manager };
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
    templateService: {},
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
    deps.templateService,
  );
  return { svc, deps };
}

const PDF = Buffer.from('%PDF-1.7 contenido');
const XLSX = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
const file = (buffer: Buffer, mimetype = 'application/octet-stream', originalname = 'x') =>
  ({ buffer, mimetype, originalname, size: buffer.length }) as Express.Multer.File;

describe('unloading-access.util', () => {
  it('acota por sucursal; superadmin y owner ven todas', () => {
    expect(canAccessSubsidiary({ role: 'user', subsidiaryIds: ['A'] }, 'A')).toBe(true);
    expect(canAccessSubsidiary({ role: 'user', subsidiaryIds: ['A'] }, 'B')).toBe(false);
    expect(canAccessSubsidiary({ role: 'admin', subsidiaryIds: ['A'] }, 'B')).toBe(false);
    expect(canAccessSubsidiary({ role: 'superadmin' }, 'B')).toBe(true);
    expect(canAccessSubsidiary({ role: 'owner' }, 'B')).toBe(true);
    expect(canAccessSubsidiary({ role: 'superadmin' }, '')).toBe(false);
    expect(() => assertSubsidiaryAccess({ role: 'user', subsidiaryIds: [] }, 'A')).toThrow(ForbiddenException);
  });

  it('estatus finales en lenguaje llano', () => {
    expect(finalStatusReason('entregado')).toBe('Ya fue entregada');
    expect(finalStatusReason('devuelto_a_fedex')).toBe('Ya se devolvió a FedEx');
    expect(finalStatusReason('en_ruta')).toBeNull();
    expect(finalStatusReason(null)).toBeNull();
  });

  it('folio de captura: solo letras, números, guion; máx 64', () => {
    expect(normalizeClientRequestId('abc-123_X')).toBe('abc-123_X');
    expect(normalizeClientRequestId('  ')).toBeNull();
    expect(normalizeClientRequestId("x'; DROP")).toBeNull();
    expect(normalizeClientRequestId('a'.repeat(65))).toBeNull();
  });

  it('revisa el contenido real de los archivos y arma nombres seguros', () => {
    expect(looksLikePdf(PDF)).toBe(true);
    expect(looksLikePdf(XLSX)).toBe(false);
    expect(looksLikeXlsx(XLSX)).toBe(true);
    expect(looksLikeXlsx(Buffer.from('<html>'))).toBe(false);
    expect(safeAttachmentName('Cabo San Lucas', 'pdf', new Date('2026-11-18T12:00:00Z'))).toBe(
      'Desembarque-Cabo_San_Lucas-2026-11-18.pdf',
    );
    expect(safeAttachmentName('../../etc/<x>', 'xlsx', new Date('2026-11-18T12:00:00Z'))).toBe(
      'Desembarque-....etcx-2026-11-18.xlsx',
    );
  });
});

describe('UnloadingService.validateOne (seguridad)', () => {
  it('de otra sucursal NO regresa datos del cliente ni cobro', async () => {
    const shipmentRepository = repo();
    shipmentRepository.findOne.mockResolvedValue({
      id: 's1', trackingNumber: '111', subsidiary: { id: 'otra' },
      recipientName: 'Ana', recipientAddress: 'Calle 1', recipientPhone: '555', payment: { amount: 300 },
    });
    const { svc } = makeService({ shipmentRepository, chargeShipmentRepository: repo() });
    const r: any = await svc.validateOne('111', 'sub-1');
    expect(r.isValid).toBe(false);
    expect(r.reason).toBe('Es de otra sucursal');
    expect(r.recipientName).toBeUndefined();
    expect(r.recipientAddress).toBeUndefined();
    expect(r.recipientPhone).toBeUndefined();
    expect(r.payment).toBeUndefined();
    expect(r.id).toBeUndefined();
  });

  it('entregada de la sucursal: cuenta (válida) pero marcada como ya entregada', async () => {
    const shipmentRepository = repo();
    shipmentRepository.findOne.mockResolvedValue({
      id: 's1', trackingNumber: '111', subsidiary: { id: 'sub-1' }, status: 'entregado', consolidatedId: 'c1',
    });
    const { svc } = makeService({ shipmentRepository, chargeShipmentRepository: repo() });
    const r = await svc.validateOne('111', 'sub-1');
    expect(r.isValid).toBe(true);
    expect(r.consolidatedId).toBe('c1');
    expect(r.alreadyFinal).toBe('Ya fue entregada');
  });

  it('busca el registro más reciente sin saltarse los devueltos', async () => {
    const shipmentRepository = repo();
    shipmentRepository.findOne.mockResolvedValue({
      id: 's1', trackingNumber: '111', subsidiary: { id: 'sub-1' }, status: 'devuelto_a_fedex',
    });
    const { svc } = makeService({ shipmentRepository, chargeShipmentRepository: repo() });
    const r = await svc.validateOne('111', 'sub-1');
    const where = shipmentRepository.findOne.mock.calls[0][0].where;
    expect(JSON.stringify(where)).not.toContain('devuelto');
    expect(r.isValid).toBe(true);
    expect(r.alreadyFinal).toBe('Ya se devolvió a FedEx');
  });

  it('guía sin sucursal: no truena', async () => {
    const shipmentRepository = repo();
    shipmentRepository.findOne.mockResolvedValue({ id: 's1', trackingNumber: '111', subsidiary: null });
    const { svc } = makeService({ shipmentRepository, chargeShipmentRepository: repo() });
    const r = await svc.validateOne('111', 'sub-1');
    expect(r.isValid).toBe(false);
    expect(r.reason).toBe('La guía no tiene sucursal asignada');
  });
});

describe('UnloadingService.create (integridad)', () => {
  const dto = (over: any = {}) => ({
    subsidiary: { id: 'sub-1' },
    vehicle: { id: 'veh-1' },
    shipments: ['s1', 's2'],
    missingTrackings: [],
    unScannedTrackings: [],
    ...over,
  });

  it('folio repetido: regresa el desembarque existente sin crear otro', async () => {
    const unloadingRepository = repo();
    unloadingRepository.findOne.mockResolvedValue({ id: 'ya-existe', clientRequestId: 'cap-1' });
    const dataSource = { createQueryRunner: jest.fn() };
    const { svc } = makeService({ unloadingRepository, dataSource });
    const r: any = await svc.create(dto({ clientRequestId: 'cap-1' }) as any, 'u1');
    expect(r.id).toBe('ya-existe');
    expect(r.duplicate).toBe(true);
    expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
  });

  it('rechaza guías de otra sucursal y no guarda nada', async () => {
    const { qr, manager } = fakeQueryRunner({
      shipments: [
        { id: 's1', trackingNumber: '111', subsidiary: { id: 'sub-1' } },
        { id: 's2', trackingNumber: '222', subsidiary: { id: 'otra' } },
      ],
    });
    const { svc } = makeService({ dataSource: { createQueryRunner: () => qr } });
    await expect(svc.create(dto() as any, 'u1')).rejects.toThrow(BadRequestException);
    await expect(svc.create(dto() as any, 'u1')).rejects.toThrow(/222/);
    expect(manager.update).not.toHaveBeenCalled();
    expect(qr.rollbackTransaction).toHaveBeenCalled();
  });

  it('no regresa a "En bodega" las entregadas: las salta y las reporta', async () => {
    const { qr, manager } = fakeQueryRunner({
      shipments: [
        { id: 's1', trackingNumber: '111', subsidiary: { id: 'sub-1' }, status: 'en_ruta' },
        { id: 's2', trackingNumber: '222', subsidiary: { id: 'sub-1' }, status: 'entregado' },
      ],
    });
    const { svc } = makeService({ dataSource: { createQueryRunner: () => qr } });
    const r: any = await svc.create(dto() as any, 'u1');
    expect(r.skippedFinal).toEqual([{ trackingNumber: '222', reason: 'Ya fue entregada' }]);
    const updatedIds = JSON.stringify(manager.update.mock.calls.map((c: any[]) => c[1]));
    expect(updatedIds).toContain('s1');
    expect(updatedIds).not.toContain('s2');
    expect(qr.commitTransaction).toHaveBeenCalled();
  });

  it('guarda unidad y sucursal solo por id', async () => {
    const { qr, manager } = fakeQueryRunner({
      shipments: [{ id: 's1', trackingNumber: '111', subsidiary: { id: 'sub-1' }, status: 'en_ruta' }],
    });
    const { svc } = makeService({ dataSource: { createQueryRunner: () => qr } });
    await svc.create(
      dto({ shipments: ['s1'], subsidiary: { id: 'sub-1', name: 'X', officeEmail: 'malo@x.com' } as any }) as any,
      'u1',
    );
    const created = manager.create.mock.calls.find((c: any[]) => c[0]?.name === 'Unloading')?.[1];
    expect(created.subsidiary).toEqual({ id: 'sub-1' });
    expect(created.vehicle).toEqual({ id: 'veh-1' });
  });

  it('si todas son finales, no crea un desembarque vacío', async () => {
    const { qr } = fakeQueryRunner({
      shipments: [{ id: 's1', trackingNumber: '111', subsidiary: { id: 'sub-1' }, status: 'devuelto_a_fedex' }],
    });
    const { svc } = makeService({ dataSource: { createQueryRunner: () => qr } });
    await expect(svc.create(dto({ shipments: ['s1'] }) as any, 'u1')).rejects.toThrow(/entregadas o devueltas/);
  });
});

describe('UnloadingService.sendByEmailSecure', () => {
  const withUnloading = (subsidiaryId = 'sub-1') => {
    const unloadingRepository = repo();
    unloadingRepository.findOne.mockResolvedValue({
      id: 'unl-1', subsidiary: { id: subsidiaryId, name: 'Cabo San Lucas' }, date: new Date('2026-11-18T12:00:00Z'),
    });
    return unloadingRepository;
  };

  it('de otra sucursal: no encontrado', async () => {
    const { svc } = makeService({ unloadingRepository: withUnloading('otra') });
    await expect(
      svc.sendByEmailSecure([file(PDF), file(XLSX)], 'unl-1', { role: 'user', subsidiaryIds: ['sub-1'] }),
    ).rejects.toThrow(NotFoundException);
  });

  it('rechaza archivos que no son PDF/Excel aunque digan que sí', async () => {
    const { svc } = makeService({ unloadingRepository: withUnloading() });
    await expect(
      svc.sendByEmailSecure(
        [file(Buffer.from('<html>'), 'application/pdf'), file(XLSX)],
        'unl-1',
        { role: 'user', subsidiaryIds: ['sub-1'] },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('nombra los adjuntos en el servidor con la sucursal de la base', async () => {
    const { svc } = makeService({ unloadingRepository: withUnloading() });
    const spy = jest.spyOn(svc, 'sendByEmail').mockResolvedValue('ok' as any);
    await svc.sendByEmailSecure(
      [file(XLSX, 'x', '../../malo.exe'), file(PDF, 'x', 'otro.exe')],
      'unl-1',
      { role: 'user', subsidiaryIds: ['sub-1'] },
    );
    const [pdf, excel, subName] = spy.mock.calls[0];
    expect(pdf.originalname).toBe('Desembarque-Cabo_San_Lucas-2026-11-18.pdf');
    expect(excel.originalname).toBe('Desembarque-Cabo_San_Lucas-2026-11-18.xlsx');
    expect(subName).toBe('Cabo San Lucas');
  });
});

describe('UnloadingService.findOneWithPackages', () => {
  it('"Hecho por" regresa solo id y nombre del usuario', async () => {
    const unloadingRepository = repo();
    unloadingRepository.findOne.mockResolvedValue({
      id: 'u', subsidiary: { id: 'sub-1' },
      createdBy: { id: 'usr', name: 'Juan', lastName: 'Pérez', password: 'hash', email: 'j@x.com' },
    });
    const { svc } = makeService({ unloadingRepository });
    const r: any = await svc.findOneWithPackages('u');
    expect(r.createdBy).toEqual({ id: 'usr', name: 'Juan Pérez' });
  });
});

describe('UnloadingController (candados)', () => {
  const ctrl = (svc: any) => new UnloadingController(svc);

  it('crear en una sucursal ajena: prohibido', () => {
    const svc = { create: jest.fn() };
    expect(() =>
      ctrl(svc).create({ subsidiary: { id: 'otra' }, shipments: ['s1'] } as any, { user: { role: 'user', subsidiaryIds: ['sub-1'] } }),
    ).toThrow(ForbiddenException);
    expect(svc.create).not.toHaveBeenCalled();
  });

  it('validar en una sucursal ajena: prohibido', () => {
    const svc = { validateOne: jest.fn() };
    expect(() =>
      ctrl(svc).validateOne({ trackingNumber: '111', subsidiaryId: 'otra' } as any, { user: { role: 'user', subsidiaryIds: ['sub-1'] } }),
    ).toThrow(ForbiddenException);
  });

  it('detalle de otra sucursal: no encontrado', async () => {
    const svc = { findOneWithPackages: jest.fn().mockResolvedValue({ id: 'u', subsidiary: { id: 'otra' } }) };
    await expect(
      ctrl(svc).findOneWithPackages('u', { user: { role: 'user', subsidiaryIds: ['sub-1'] } }),
    ).rejects.toThrow(NotFoundException);
  });

  it('detalle de su sucursal: sí', async () => {
    const svc = { findOneWithPackages: jest.fn().mockResolvedValue({ id: 'u', subsidiary: { id: 'sub-1' } }) };
    await expect(
      ctrl(svc).findOneWithPackages('u', { user: { role: 'user', subsidiaryIds: ['sub-1'] } }),
    ).resolves.toEqual({ id: 'u', subsidiary: { id: 'sub-1' } });
  });
});

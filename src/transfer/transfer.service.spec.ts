import { BadRequestException } from '@nestjs/common';
import { Income, Subsidiary } from 'src/entities';
import { TransferService } from './transfer.service';

const ORIGIN = '11111111-1111-1111-1111-111111111111';
const DEST = '22222222-2222-2222-2222-222222222222';

function setup() {
  const saved: any[] = [];
  const findOne = jest.fn(async (_e: any, { where }: any) => ({
    id: where.id,
    tycoAmount: where.id === DEST ? 1000 : 2000,
    airportAmount: 3000,
    secondAbordAmount: 500,
  }));
  const manager = {
    findOne,
    create: jest.fn((entity: any, data: any) => ({ __entity: entity, ...data })),
    save: jest.fn(async (x: any) => { saved.push(x); return x; }),
  };
  const qr = {
    connect: jest.fn(), startTransaction: jest.fn(), commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(), release: jest.fn(), manager,
  };
  const service = new TransferService({} as any, { createQueryRunner: () => qr } as any);
  const income = () => saved.find((x) => x.__entity === Income);
  return { service, income, findOne, qr };
}

const base = { transferDate: new Date('2026-10-01T00:00:00Z'), totalAmount: 0 };

describe('TransferService.create — origen externo', () => {
  beforeAll(() => jest.spyOn(console, 'log').mockImplementation(() => {}));

  it('origen externo + destino sucursal: ingreso y tarifas van al destino', async () => {
    const { service, income, findOne } = setup();
    await service.create({ ...base, otherOrigin: ' Bodega cliente ', destinationId: DEST, transferType: 'tyco' } as any, 'u1');
    expect(findOne).toHaveBeenCalledWith(Subsidiary, { where: { id: DEST } });
    expect(income().subsidiary).toEqual({ id: DEST });
    expect(income().cost).toBe(1000);
  });

  it('guarda el nombre del origen externo sin espacios', async () => {
    const { service, qr } = setup();
    await service.create({ ...base, otherOrigin: ' Bodega cliente ', destinationId: DEST, transferType: 'otro', amount: 800 } as any, 'u1');
    const transfer = qr.manager.save.mock.calls[0][0];
    expect(transfer.otherOrigin).toBe('Bodega cliente');
    expect(transfer.originId).toBeUndefined();
  });

  it('origen externo sin sucursal destino: rechaza', async () => {
    const { service, qr } = setup();
    await expect(
      service.create({ ...base, otherOrigin: 'X', otherDestination: 'Y', transferType: 'otro', amount: 1 } as any, 'u1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(qr.rollbackTransaction).toHaveBeenCalled();
  });

  it('sin origen alguno: rechaza', async () => {
    const { service } = setup();
    await expect(service.create({ ...base, destinationId: DEST, transferType: 'otro' } as any, 'u1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('sin cambios: tyco desde sucursal origen sigue en el origen', async () => {
    const { service, income } = setup();
    await service.create({ ...base, originId: ORIGIN, otherDestination: 'Tyco', transferType: 'tyco' } as any, 'u1');
    expect(income().subsidiary).toEqual({ id: ORIGIN });
    expect(income().cost).toBe(2000);
  });

  it('sin cambios: especial entre sucursales va al destino', async () => {
    const { service, income } = setup();
    await service.create({ ...base, originId: ORIGIN, destinationId: DEST, transferType: 'otro', amount: 900 } as any, 'u1');
    expect(income().subsidiary).toEqual({ id: DEST });
  });
});

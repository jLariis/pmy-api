import { incomeStatementCategory, ResportsService } from './resports.service';

/** Query builder encadenable que devuelve `rows` en getMany. */
function qb(rows: any[]) {
  const b: any = {};
  for (const m of ['leftJoin', 'leftJoinAndSelect', 'addSelect', 'where', 'andWhere', 'select']) b[m] = () => b;
  b.getMany = async () => rows;
  return b;
}

function makeService(incomes: any[], chargeable: (carrier: string, code: string) => boolean | undefined = () => undefined) {
  const svc = Object.create(ResportsService.prototype) as any;
  svc.subsidiaryRepository = { createQueryBuilder: () => ({ where: () => ({}), select: () => ({ getMany: async () => [] }) }) };
  svc.subsidiaryRepository.createQueryBuilder = () => {
    const b: any = { where: () => b, select: () => b, getMany: async () => [{ name: 'Hermosillo' }] };
    return b;
  };
  svc.incomeRepository = { createQueryBuilder: () => qb(incomes) };
  svc.expenseRepository = { createQueryBuilder: () => qb([]) };
  svc.chargeRules = { buildResolver: async () => ({ isChargeable: chargeable }) };
  return svc;
}

const sub = { id: 'hmo', countTransfersAsIncome: false };

describe('Estado de Resultados — regla única de ingresos', () => {
  it('agrupa por día local, cuenta el "Otro" manual y omite lo que no cobra', async () => {
    const svc = makeService(
      [
        // Carga del PRIMER día guardada a 00:00Z: antes se perdía por la cota de 07:00Z.
        { sourceType: 'charge', shipmentType: 'fedex', incomeType: 'entregado', cost: '4228', date: new Date('2026-10-19T00:00:00Z'), subsidiary: sub },
        // Envío a las 03:00Z del 20 = 19 local.
        { sourceType: 'shipment', shipmentType: 'fedex', incomeType: 'entregado', cost: '52', date: new Date('2026-10-20T03:00:00Z'), subsidiary: sub },
        // Corrección "Otro" sin guía.
        { sourceType: 'manual', shipmentType: 'fedex', incomeType: 'entregado', cost: '150', date: new Date('2026-10-20T19:00:00Z'), subsidiary: sub, editReason: 'cobro extra' },
        // Traslado con la sucursal configurada para NO contarlos.
        { sourceType: 'tyco', shipmentType: 'fedex', incomeType: 'tyco', cost: '650', date: new Date('2026-10-20T07:00:00Z'), subsidiary: sub },
        // DEX03 sin cobro por regla.
        { sourceType: 'shipment', shipmentType: 'fedex', incomeType: 'no_entregado', nonDeliveryStatus: '03', cost: '52', date: new Date('2026-10-20T19:00:00Z'), subsidiary: sub },
        // Fuera del rango (día local 26).
        { sourceType: 'shipment', shipmentType: 'fedex', incomeType: 'entregado', cost: '52', date: new Date('2026-10-26T19:00:00Z'), subsidiary: sub },
      ],
      (_carrier, code) => (code === 'DELIVERED' ? true : code === '03' ? false : undefined),
    );

    const out = await svc.loadIncomeStatementAggregates(['hmo'], '2026-10-19', '2026-10-25');

    expect(out.incomeMatrix).toEqual({
      Cargas: { '2026-10-19': 4228 },
      'Envíos FedEx': { '2026-10-19': 52 },
      'Otros ingresos': { '2026-10-20': 150 },
    });
    const manual = out.detailRows.find((r: any) => r.category === 'Otros ingresos');
    expect(manual.desc).toBe('Corrección: cobro extra');
  });

  it('categoría por paquetería y tipo', () => {
    expect(incomeStatementCategory({ sourceType: 'shipment', shipmentType: 'dhl' } as any)).toBe('Envíos DHL');
    expect(incomeStatementCategory({ sourceType: 'special_transfer' } as any)).toBe('Traslados especiales');
  });
});

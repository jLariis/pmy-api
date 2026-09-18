import { computeVerdict } from './package-verdict.util';
import { ShipmentStatusType } from '../../common/enums/shipment-status-type.enum';

const base = {
  currentStatus: null as ShipmentStatusType | null,
  history: [] as Array<{ status: string | null; timestamp: Date | string | null }>,
  hasConsolidado: false,
  routeDate: null as Date | string | null,
  incomeDate: null as Date | string | null,
  fedexVerified: true,
};

describe('computeVerdict', () => {
  it('entregado por fedex + ruta el mismo día del ingreso → delivered_by_us (ok, fix a ENTREGADO)', () => {
    const v = computeVerdict({
      ...base,
      currentStatus: ShipmentStatusType.ENTREGADO_POR_FEDEX,
      hasConsolidado: true,
      routeDate: '2026-09-17T00:00:00.000Z',
      incomeDate: '2026-09-17T15:00:00.000Z',
    });
    expect(v.code).toBe('delivered_by_us');
    expect(v.level).toBe('ok');
    expect(v.suggestedAction).toEqual({ kind: 'fix_status', to: ShipmentStatusType.ENTREGADO });
  });

  it('entregado por fedex con ingreso y sin ruta ese día → fedex_delivery_doubtful (danger, borrar)', () => {
    const v = computeVerdict({
      ...base,
      currentStatus: ShipmentStatusType.ENTREGADO_POR_FEDEX,
      routeDate: null,
      incomeDate: '2026-09-17T15:00:00.000Z',
    });
    expect(v.code).toBe('fedex_delivery_doubtful');
    expect(v.level).toBe('danger');
    expect(v.suggestedAction).toEqual({ kind: 'delete_income' });
  });

  it('entregado por fedex con ruta en día distinto al ingreso → fedex_delivery_doubtful', () => {
    const v = computeVerdict({
      ...base,
      currentStatus: ShipmentStatusType.ENTREGADO_POR_FEDEX,
      routeDate: '2026-09-16T00:00:00.000Z',
      incomeDate: '2026-09-17T15:00:00.000Z',
    });
    expect(v.code).toBe('fedex_delivery_doubtful');
  });

  it('entregado por fedex sin FedEx confirmado → unverified (warn, sin acción)', () => {
    const v = computeVerdict({
      ...base,
      currentStatus: ShipmentStatusType.ENTREGADO_POR_FEDEX,
      incomeDate: '2026-09-17T15:00:00.000Z',
      fedexVerified: false,
    });
    expect(v.code).toBe('unverified');
    expect(v.level).toBe('warn');
    expect(v.suggestedAction).toEqual({ kind: 'none' });
  });

  it('entrega nuestra normal con ingreso → our_delivery_ok', () => {
    const v = computeVerdict({
      ...base,
      currentStatus: ShipmentStatusType.ENTREGADO,
      history: [{ status: ShipmentStatusType.ENTREGADO, timestamp: '2026-09-17T15:00:00.000Z' }],
      incomeDate: '2026-09-17T15:00:00.000Z',
    });
    expect(v.code).toBe('our_delivery_ok');
    expect(v.level).toBe('ok');
  });

  it('ingreso fechado en día sin evento → date_mismatch (warn)', () => {
    const v = computeVerdict({
      ...base,
      currentStatus: ShipmentStatusType.ENTREGADO,
      history: [{ status: ShipmentStatusType.ENTREGADO, timestamp: '2026-09-15T15:00:00.000Z' }],
      incomeDate: '2026-09-17T15:00:00.000Z',
    });
    expect(v.code).toBe('date_mismatch');
    expect(v.level).toBe('warn');
  });

  it('cobro sin evento terminal que lo respalde → income_without_support (danger)', () => {
    const v = computeVerdict({
      ...base,
      currentStatus: ShipmentStatusType.EN_RUTA,
      history: [{ status: ShipmentStatusType.EN_RUTA, timestamp: '2026-09-17T15:00:00.000Z' }],
      incomeDate: '2026-09-17T15:00:00.000Z',
    });
    expect(v.code).toBe('income_without_support');
    expect(v.level).toBe('danger');
  });

  it('sin ingreso → no_income_ok (ok)', () => {
    const v = computeVerdict({ ...base, currentStatus: ShipmentStatusType.EN_RUTA });
    expect(v.code).toBe('no_income_ok');
    expect(v.level).toBe('ok');
  });
});

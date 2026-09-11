import { detectAnomalies } from './detect-anomalies.util';
import { ShipmentStatusType } from '../../common/enums/shipment-status-type.enum';

describe('detectAnomalies', () => {
  it('sin anomalías: entregado con ingreso del mismo día y evento terminal', () => {
    const res = detectAnomalies({
      currentStatus: ShipmentStatusType.ENTREGADO,
      history: [{ status: 'entregado', timestamp: '2026-09-03T14:00:00Z' }],
      income: { date: '2026-09-03T12:00:00Z' },
      statusDate: '2026-09-03T14:00:00Z',
    });
    expect(res).toEqual([]);
  });

  it('date_mismatch: ingreso en día distinto al estatus', () => {
    const res = detectAnomalies({
      currentStatus: ShipmentStatusType.ENTREGADO,
      history: [{ status: 'entregado', timestamp: '2026-09-03T14:00:00Z' }],
      income: { date: '2026-09-05T12:00:00Z' },
      statusDate: '2026-09-03T14:00:00Z',
    });
    expect(res.map((a) => a.code)).toContain('date_mismatch');
  });

  it('status_regressed: en_ruta ahora pero hubo DEX07 (rechazado) antes', () => {
    const res = detectAnomalies({
      currentStatus: ShipmentStatusType.EN_RUTA,
      history: [
        { status: 'rechazado', timestamp: '2026-09-03T10:00:00Z' },
        { status: 'en_ruta', timestamp: '2026-09-03T15:00:00Z' },
      ],
      income: null,
      statusDate: '2026-09-03T15:00:00Z',
    });
    expect(res.map((a) => a.code)).toContain('status_regressed');
  });

  it('delivered_by_fedex: hay ingreso pero FedEx entregó (entregado_por_fedex)', () => {
    const res = detectAnomalies({
      currentStatus: ShipmentStatusType.ENTREGADO_POR_FEDEX,
      history: [{ status: 'entregado_por_fedex', timestamp: '2026-09-03T14:00:00Z' }],
      income: { date: '2026-09-03T12:00:00Z' },
      statusDate: '2026-09-03T14:00:00Z',
    });
    expect(res.map((a) => a.code)).toContain('delivered_by_fedex');
  });

  it('income_without_support: hay ingreso pero el historial no tiene evento terminal', () => {
    const res = detectAnomalies({
      currentStatus: ShipmentStatusType.EN_RUTA,
      history: [{ status: 'en_ruta', timestamp: '2026-09-03T15:00:00Z' }],
      income: { date: '2026-09-03T12:00:00Z' },
      statusDate: '2026-09-03T15:00:00Z',
    });
    expect(res.map((a) => a.code)).toContain('income_without_support');
  });
});

import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { resolveCanonicalStatus } from './fedex-status.mapping';
import { FedexStatusResolver } from './fedex-status.resolver';

describe('resolveCanonicalStatus (mapeo canónico nuevo)', () => {
  it('DL (entregado) manda por encima de todo', () => {
    expect(resolveCanonicalStatus({ derivedCode: 'DL', exceptionCode: '07' })).toBe(
      ShipmentStatusType.ENTREGADO,
    );
  });

  it('005 (entrega por terceros) → entregado_por_fedex', () => {
    expect(resolveCanonicalStatus({ exceptionCode: '005' })).toBe(
      ShipmentStatusType.ENTREGADO_POR_FEDEX,
    );
  });

  it('exceptionCode refina el estatus (IT + 14 → retorno_abandono_fedex)', () => {
    expect(resolveCanonicalStatus({ derivedCode: 'IT', exceptionCode: '14' })).toBe(
      ShipmentStatusType.RETORNO_ABANDONO_FEDEX,
    );
  });

  it('sin exceptionCode, mapea por derivedCode (IT → en_ruta)', () => {
    expect(resolveCanonicalStatus({ derivedCode: 'IT' })).toBe(ShipmentStatusType.EN_RUTA);
  });

  it('solo exceptionCode conocido (08 → cliente_no_disponible)', () => {
    expect(resolveCanonicalStatus({ exceptionCode: '08' })).toBe(
      ShipmentStatusType.CLIENTE_NO_DISPONIBLE,
    );
  });

  it('sin ninguna señal → null', () => {
    expect(resolveCanonicalStatus({})).toBeNull();
  });

  it('código desconocido → DESCONOCIDO (no null, hubo señal)', () => {
    expect(resolveCanonicalStatus({ derivedCode: 'ZZ' })).toBe(ShipmentStatusType.DESCONOCIDO);
  });
});

describe('FedexStatusResolver.getLatestStatus', () => {
  function makeResolver(trackResult: any, throwErr?: Error) {
    const fedex = {
      trackPackage: jest.fn(async () => {
        if (throwErr) throw throwErr;
        return { output: { completeTrackResults: [{ trackResults: [trackResult] }] } };
      }),
    } as any;
    return new FedexStatusResolver(fedex);
  }

  it('normaliza y valida un trackResult con estatus y último evento', async () => {
    const resolver = makeResolver({
      latestStatusDetail: { code: 'IT', derivedCode: 'IT', statusByLocale: 'In transit', description: 'On the way' },
      scanEvents: [
        { eventType: 'IT', eventDescription: 'In transit', date: '2026-08-10T10:00:00Z', scanLocation: { city: 'Hermosillo' } },
        { eventType: 'PU', eventDescription: 'Picked up', date: '2026-08-09T08:00:00Z' },
      ],
    });

    const res = await resolver.getLatestStatus('T1');
    expect(res.found).toBe(true);
    expect(res.status).toBe(ShipmentStatusType.EN_RUTA);
    expect(res.derivedCode).toBe('IT');
    // Último evento = el más reciente por fecha.
    expect(res.lastEvent?.type).toBe('IT');
    expect(res.lastEvent?.location).toBe('Hermosillo');
    expect(res.validation.ok).toBe(true);
  });

  it('exceptionCode del ancillary refina (14 → retorno_abandono_fedex)', async () => {
    const resolver = makeResolver({
      latestStatusDetail: { code: 'IT', derivedCode: 'IT', ancillaryDetails: [{ reason: '14' }] },
      scanEvents: [{ eventType: 'IT', date: '2026-08-10T10:00:00Z' }],
    });
    const res = await resolver.getLatestStatus('T2');
    expect(res.exceptionCode).toBe('14');
    expect(res.status).toBe(ShipmentStatusType.RETORNO_ABANDONO_FEDEX);
  });

  it('sin scanEvents ni latestStatusDetail → found:false y validación con issues', async () => {
    const resolver = makeResolver({});
    const res = await resolver.getLatestStatus('T3');
    expect(res.found).toBe(false);
    expect(res.validation.ok).toBe(false);
    expect(res.validation.issues.length).toBeGreaterThan(0);
  });

  it('error de red → found:false con error, no lanza', async () => {
    const resolver = makeResolver(null, new Error('ENOTFOUND'));
    const res = await resolver.getLatestStatus('T4');
    expect(res.found).toBe(false);
    expect(res.error).toContain('ENOTFOUND');
  });
});

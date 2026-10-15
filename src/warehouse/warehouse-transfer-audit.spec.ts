import { AuditAction } from 'src/common/enums/audit.enum';
import { buildTransferAudit, describeOutboundForAudit, describeTransferAudit } from './warehouse-transfer-audit';

const base = {
  outboundId: 'out-1',
  folio: 'T-123',
  origin: { id: 'hmo', name: 'Bodega Hermosillo' },
  destination: { id: 'pen', name: 'Puerto Peñasco' },
  vehicle: { id: 'v1', name: 'CRAFTER', plateNumber: 'ABC-1' },
  drivers: [{ id: 'd1', name: 'Francisco' }],
  now: new Date('2026-10-14T01:22:13Z'),
};

describe('buildTransferAudit', () => {
  const audit = buildTransferAudit({
    ...base,
    packages: [
      { id: 's1', trackingNumber: '111', isCharge: false, before: { status: 'pendiente', subsidiary: { id: 'hmo', name: 'Bodega Hermosillo' } } },
      { id: 's2', trackingNumber: '222', isCharge: false, before: { status: 'entregado', subsidiary: { id: 'hmo', name: 'Bodega Hermosillo' } } },
      { id: 'c1', trackingNumber: '333', isCharge: true, before: { status: 'en_bodega', subsidiary: { id: 'cab', name: 'Caborca' } } },
      { id: 's3', trackingNumber: '444', isCharge: false, before: null },
    ],
  });

  it('guarda origen, destino, unidad, choferes y hora local de Hermosillo', () => {
    expect(audit.origen).toEqual({ id: 'hmo', nombre: 'Bodega Hermosillo' });
    expect(audit.destino).toEqual({ id: 'pen', nombre: 'Puerto Peñasco' });
    expect(audit.unidad).toEqual({ id: 'v1', nombre: 'CRAFTER', placas: 'ABC-1' });
    expect(audit.choferes).toEqual([{ id: 'd1', nombre: 'Francisco' }]);
    expect(audit.fechaUtc).toBe('2026-10-14T01:22:13.000Z');
    expect(audit.fechaHermosillo).toBe('2026-10-13 18:22:13');
  });

  it('guarda el estado previo de cada guía y el nuevo', () => {
    expect(audit.total).toBe(4);
    expect(audit.paquetes[2]).toEqual({
      id: 'c1', guia: '333', carga: true,
      sucursalAnteriorId: 'cab', sucursalAnterior: 'Caborca',
      estatusAnterior: 'en_bodega', estatusNuevo: 'en_ruta', sucursalNuevaId: 'pen',
    });
    expect(audit.porEstatusAnterior).toEqual({ pendiente: 1, entregado: 1, en_bodega: 1, no_encontrado: 1 });
  });

  it('cuenta avisos: entregadas, fuera de origen y no encontradas', () => {
    expect(audit.avisos).toEqual({ yaEntregadas: 1, fueraDeOrigen: 1, noEncontradas: 1 });
    expect(describeTransferAudit(audit)).toBe(
      'Traspasó 4 paquetes de Bodega Hermosillo a Puerto Peñasco · folio T-123 · unidad CRAFTER · chofer Francisco · 1 ya entregadas · 1 no estaban en Bodega Hermosillo · 1 no encontradas',
    );
  });

  it('describeOutboundForAudit marca la acción como traspaso y deja el detalle por guía fuera del resumen', () => {
    const d = describeOutboundForAudit({ response: { audit }, result: 'success' });
    expect(d?.action).toBe(AuditAction.TRANSFER);
    expect(d?.entityName).toBe('Traspaso');
    expect((d?.details as any).paquetes).toBeUndefined();
    expect((d?.details as any).destino.nombre).toBe('Puerto Peñasco');
  });

  it('describeOutboundForAudit no toca salidas a ruta ni errores', () => {
    expect(describeOutboundForAudit({ response: { data: {} }, result: 'success' })).toBeUndefined();
    expect(describeOutboundForAudit({ response: undefined, result: 'error' })).toBeUndefined();
  });
});

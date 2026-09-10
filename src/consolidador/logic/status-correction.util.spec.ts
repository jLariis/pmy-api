import { deriveStatusCorrection } from './status-correction.util';
import { ShipmentStatusType } from '../../common/enums/shipment-status-type.enum';
import { IncomeStatus } from '../../common/enums/income-status.enum';

describe('deriveStatusCorrection', () => {
  it('sin diff → none', () => {
    expect(deriveStatusCorrection(ShipmentStatusType.EN_RUTA, ShipmentStatusType.EN_RUTA)).toEqual({
      newStatus: ShipmentStatusType.EN_RUTA,
      incomeEffect: { kind: 'none' },
    });
  });
  it('fedex entregado y interno no → reclasifica a entregado', () => {
    expect(deriveStatusCorrection(ShipmentStatusType.EN_RUTA, ShipmentStatusType.ENTREGADO)).toEqual({
      newStatus: ShipmentStatusType.ENTREGADO,
      incomeEffect: { kind: 'reclassify', incomeType: IncomeStatus.ENTREGADO },
    });
  });
  it('fedex sin dato → no toca', () => {
    expect(deriveStatusCorrection(ShipmentStatusType.EN_RUTA, null)).toEqual({
      newStatus: ShipmentStatusType.EN_RUTA,
      incomeEffect: { kind: 'none' },
    });
  });
  it('devuelto a fedex → reclasifica income a no_entregado', () => {
    expect(deriveStatusCorrection(ShipmentStatusType.EN_RUTA, ShipmentStatusType.DEVUELTO_A_FEDEX)).toEqual({
      newStatus: ShipmentStatusType.DEVUELTO_A_FEDEX,
      incomeEffect: { kind: 'reclassify', incomeType: IncomeStatus.NO_ENTREGADO },
    });
  });
  it('rechazado → reclasifica income a no_entregado', () => {
    expect(deriveStatusCorrection(ShipmentStatusType.EN_RUTA, ShipmentStatusType.RECHAZADO)).toEqual({
      newStatus: ShipmentStatusType.RECHAZADO,
      incomeEffect: { kind: 'reclassify', incomeType: IncomeStatus.NO_ENTREGADO },
    });
  });
  it('otro cambio de estatus → solo corrige estatus, income intacto', () => {
    expect(deriveStatusCorrection(ShipmentStatusType.EN_RUTA, ShipmentStatusType.EN_BODEGA)).toEqual({
      newStatus: ShipmentStatusType.EN_BODEGA,
      incomeEffect: { kind: 'none' },
    });
  });
});

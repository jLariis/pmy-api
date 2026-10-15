import { BadRequestException } from '@nestjs/common';
import { OutboundType } from 'src/common/enums/outbound-type.enum';
import { assertOutboundConsistency } from './warehouse.validation';

describe('assertOutboundConsistency', () => {
  it('acepta dispatch con kms y rutas', () => {
    expect(() =>
      assertOutboundConsistency({ type: OutboundType.DISPATCH, kms: 10, routes: ['r1'] }),
    ).not.toThrow();
  });

  it('rechaza dispatch sin rutas', () => {
    expect(() =>
      assertOutboundConsistency({ type: OutboundType.DISPATCH, kms: 10, routes: [] }),
    ).toThrow(BadRequestException);
  });

  it('rechaza dispatch sin kms', () => {
    expect(() =>
      assertOutboundConsistency({ type: OutboundType.DISPATCH, routes: ['r1'] }),
    ).toThrow(BadRequestException);
  });

  it('acepta transfer con destinationId y sin kms/rutas', () => {
    expect(() =>
      assertOutboundConsistency({ type: OutboundType.TRANSFER, destinationId: 'sucursal-1' }),
    ).not.toThrow();
  });

  it('rechaza transfer sin destinationId', () => {
    expect(() =>
      assertOutboundConsistency({ type: OutboundType.TRANSFER }),
    ).toThrow(BadRequestException);
  });

  it('rechaza transfer con destinationId vacío', () => {
    expect(() =>
      assertOutboundConsistency({ type: OutboundType.TRANSFER, warehouse: 'bodega-1', destinationId: '  ' }),
    ).toThrow('Debe seleccionar la sucursal destino para un traspaso.');
  });

  it('rechaza transfer hacia la misma bodega de origen', () => {
    expect(() =>
      assertOutboundConsistency({ type: OutboundType.TRANSFER, warehouse: 'bodega-1', destinationId: 'bodega-1' }),
    ).toThrow('La sucursal destino no puede ser la misma bodega de origen.');
  });

  it('acepta transfer hacia otra sucursal', () => {
    expect(() =>
      assertOutboundConsistency({ type: OutboundType.TRANSFER, warehouse: 'bodega-1', destinationId: 'sucursal-2' }),
    ).not.toThrow();
  });
});

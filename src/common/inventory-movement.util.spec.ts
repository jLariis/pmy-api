import { INVENTORY_STATUS_SOURCE, isInventoryConfirmationRow, realMovementSql } from './inventory-movement.util';

describe('inventory-movement.util', () => {
  it('reconoce renglones nuevos por source', () => {
    expect(isInventoryConfirmationRow({ source: INVENTORY_STATUS_SOURCE, notes: null })).toBe(true);
  });

  it('reconoce renglones históricos por la nota (con y sin acento, F2 incluido)', () => {
    expect(isInventoryConfirmationRow({ notes: 'Paquete confirmado en inventario físico (Folio Inv: 1) en Cabo' })).toBe(true);
    expect(isInventoryConfirmationRow({ notes: 'Paquete F2 confirmado en inventario fisico (Folio Inv: 2)' })).toBe(true);
  });

  it('no confunde movimientos reales', () => {
    expect(isInventoryConfirmationRow({ source: null, notes: 'On FedEx vehicle for delivery' })).toBe(false);
    expect(isInventoryConfirmationRow({ source: 'route_closure_manual', notes: 'Entregado' })).toBe(false);
    expect(isInventoryConfirmationRow(null)).toBe(false);
  });

  it('arma la condición SQL con y sin alias', () => {
    expect(realMovementSql()).toContain("source <> 'inventory'");
    expect(realMovementSql('ss')).toContain('ss.source IS NULL');
    expect(realMovementSql('ss')).toContain('ss.notes NOT LIKE');
  });
});

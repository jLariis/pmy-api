import { canAccessSubsidiary, foreignTrackings } from './inventory-scope.util';

describe('canAccessSubsidiary', () => {
  it('roles globales ven todo', () => {
    expect(canAccessSubsidiary({ role: 'SuperAdmin', subsidiaryIds: [] }, 'x')).toBe(true);
    expect(canAccessSubsidiary({ role: 'owner' }, null)).toBe(true);
  });

  it('los demás solo sus sucursales', () => {
    expect(canAccessSubsidiary({ role: 'admin', subsidiaryIds: ['a'] }, 'a')).toBe(true);
    expect(canAccessSubsidiary({ role: 'admin', subsidiaryIds: ['a'] }, 'b')).toBe(false);
    expect(canAccessSubsidiary({ role: 'bodega', subsidiaryIds: ['a'] }, null)).toBe(false);
    expect(canAccessSubsidiary(undefined, 'a')).toBe(false);
  });
});

describe('foreignTrackings', () => {
  it('lista (sin repetir) las guías de otra sucursal o sin sucursal', () => {
    const pkgs = [
      { trackingNumber: '1', subsidiary: { id: 'cabo' } },
      { trackingNumber: '2', subsidiary: { id: 'lapaz' } },
      { trackingNumber: '2', subsidiary: { id: 'lapaz' } },
      { trackingNumber: '3', subsidiary: null },
    ];
    expect(foreignTrackings(pkgs, 'cabo')).toEqual(['2', '3']);
  });
});

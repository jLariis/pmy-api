import {
  rollupConsolidatedPackageStats,
  emptyPackageStats,
  ConsolidatedRollupInput,
} from './consolidated-package-rollup';

const row = (o: Partial<ConsolidatedRollupInput>): ConsolidatedRollupInput => ({
  subsidiaryId: 's1', type: 'ordinario', numberOfPackages: 0,
  entregado: 0, dex03: 0, dex07: 0, dex08: 0, en_ruta: 0, otros: 0, countF2: 0, ...o,
});

describe('rollupConsolidatedPackageStats', () => {
  it('suma numberOfPackages (declarado) y el desglose real por sucursal', () => {
    const map = rollupConsolidatedPackageStats([
      row({ subsidiaryId: 's1', type: 'ordinario', numberOfPackages: 10, entregado: 4, dex07: 1, en_ruta: 2, countF2: 3 }),
      row({ subsidiaryId: 's1', type: 'aereo', numberOfPackages: 5, entregado: 2, dex03: 1, otros: 1, countF2: 1 }),
    ]);
    const s = map.get('s1')!;
    expect(s.totalPackages).toBe(15);          // declarado
    expect(s.deliveredPackages).toBe(6);
    expect(s.undeliveredPackages).toBe(2);     // dex03+dex07+dex08 = 1+1+0
    expect(s.byExceptionCode).toEqual({ code07: 1, code08: 0, code03: 1, unknown: 1 });
    expect(s.inTransitPackages).toBe(2);
    expect(s.totalCharges).toBe(4);            // countF2 = 3+1
    expect(s.consolidations).toEqual({ ordinary: 1, air: 1, total: 2 });
  });

  it('clasifica carga en el total pero no en ordinary/air', () => {
    const map = rollupConsolidatedPackageStats([
      row({ subsidiaryId: 's1', type: 'carga', numberOfPackages: 7 }),
      row({ subsidiaryId: 's1', type: 'ordinario', numberOfPackages: 3 }),
    ]);
    const s = map.get('s1')!;
    expect(s.consolidations).toEqual({ ordinary: 1, air: 0, total: 2 });
    expect(s.totalPackages).toBe(10);
  });

  it('coacciona numberOfPackages string/null a numero', () => {
    const map = rollupConsolidatedPackageStats([
      row({ subsidiaryId: 's1', numberOfPackages: '8' as any }),
      row({ subsidiaryId: 's1', numberOfPackages: null as any }),
    ]);
    expect(map.get('s1')!.totalPackages).toBe(8);
  });

  it('separa sucursales distintas', () => {
    const map = rollupConsolidatedPackageStats([
      row({ subsidiaryId: 's1', numberOfPackages: 4 }),
      row({ subsidiaryId: 's2', numberOfPackages: 9 }),
    ]);
    expect(map.get('s1')!.totalPackages).toBe(4);
    expect(map.get('s2')!.totalPackages).toBe(9);
  });

  it('emptyPackageStats devuelve todo en cero', () => {
    expect(emptyPackageStats()).toEqual({
      totalPackages: 0, deliveredPackages: 0, undeliveredPackages: 0,
      byExceptionCode: { code07: 0, code08: 0, code03: 0, unknown: 0 },
      inTransitPackages: 0, totalCharges: 0,
      consolidations: { ordinary: 0, air: 0, total: 0 },
    });
  });
});

describe('paridad dashboard vs pantalla Consolidados', () => {
  it('el rollup reproduce la suma directa de findAll para el mismo scope', () => {
    // Salida simulada de ConsolidatedService.findAll (subset de shipmentCounts que usa el rollup)
    const findAllOut = [
      { subsidiary: { id: 's1' }, type: 'ordinario', numberOfPackages: 20, shipmentCounts: { entregado: 12, dex03: 1, dex07: 2, dex08: 0, en_ruta: 3, otros: 1, countF2: 4 } },
      { subsidiary: { id: 's1' }, type: 'aereo',     numberOfPackages: 8,  shipmentCounts: { entregado: 5,  dex03: 0, dex07: 1, dex08: 1, en_ruta: 1, otros: 0, countF2: 0 } },
      { subsidiary: { id: 's2' }, type: 'carga',     numberOfPackages: 30, shipmentCounts: { entregado: 25, dex03: 2, dex07: 0, dex08: 0, en_ruta: 2, otros: 1, countF2: 9 } },
    ];

    // Adaptador identico al de kpi.service (getSubsidiariesKpis)
    const rows: ConsolidatedRollupInput[] = findAllOut.map((c: any) => ({
      subsidiaryId: c.subsidiary.id, type: c.type, numberOfPackages: c.numberOfPackages,
      entregado: c.shipmentCounts.entregado, dex03: c.shipmentCounts.dex03,
      dex07: c.shipmentCounts.dex07, dex08: c.shipmentCounts.dex08,
      en_ruta: c.shipmentCounts.en_ruta, otros: c.shipmentCounts.otros, countF2: c.shipmentCounts.countF2,
    }));
    const map = rollupConsolidatedPackageStats(rows);

    // Suma directa "a mano" (lo que hace la pantalla de Consolidados)
    const sum = (sub: string, f: (c: any) => number) =>
      findAllOut.filter(c => c.subsidiary.id === sub).reduce((a, c) => a + f(c), 0);

    for (const sub of ['s1', 's2']) {
      const s = map.get(sub)!;
      expect(s.totalPackages).toBe(sum(sub, c => c.numberOfPackages));
      expect(s.deliveredPackages).toBe(sum(sub, c => c.shipmentCounts.entregado));
      expect(s.undeliveredPackages).toBe(sum(sub, c => c.shipmentCounts.dex03 + c.shipmentCounts.dex07 + c.shipmentCounts.dex08));
      expect(s.inTransitPackages).toBe(sum(sub, c => c.shipmentCounts.en_ruta));
    }
  });
});

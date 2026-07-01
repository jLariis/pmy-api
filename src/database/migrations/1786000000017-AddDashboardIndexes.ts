import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Índices para el dashboard (KpiService.getSubsidiariesKpis). Sus 5 agregaciones
 * filtran por rango de fecha y agrupan por `subsidiaryId`, pero esas columnas no
 * estaban indexadas → full table scans en tablas grandes. Compuestos
 * (subsidiaryId, fecha) cubren el patrón `WHERE fecha BETWEEN … GROUP BY subsidiaryId`.
 */
export class AddDashboardIndexes1786000000017 implements MigrationInterface {
  name = 'AddDashboardIndexes1786000000017';

  private readonly indexes: { name: string; table: string; cols: string }[] = [
    { name: 'idx_income_sub_date', table: 'income', cols: '`subsidiaryId`, `date`' },
    { name: 'idx_expense_sub_date', table: 'expense', cols: '`subsidiaryId`, `date`' },
    { name: 'idx_charge_sub_date', table: 'charge', cols: '`subsidiaryId`, `chargeDate`' },
    { name: 'idx_cons_sub_date', table: 'consolidated', cols: '`subsidiaryId`, `date`' },
    { name: 'idx_shipment_sub_created', table: 'shipment', cols: '`subsidiaryId`, `createdAt`' },
  ];

  public async up(q: QueryRunner): Promise<void> {
    for (const ix of this.indexes) {
      await q
        .query(`CREATE INDEX \`${ix.name}\` ON \`${ix.table}\` (${ix.cols})`)
        .catch((e: any) => {
          // Ignora "ya existe" o tabla/columna ausente en algún entorno; no aborta.
          if (/Duplicate key name|already exists|doesn't exist|Unknown column/i.test(e?.message || '')) return undefined;
          throw e;
        });
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const ix of this.indexes) {
      await q.query(`DROP INDEX \`${ix.name}\` ON \`${ix.table}\``).catch(() => undefined);
    }
  }
}

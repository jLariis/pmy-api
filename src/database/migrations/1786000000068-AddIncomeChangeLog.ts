import { MigrationInterface, QueryRunner, Table } from 'typeorm';

/**
 * Historial de cambios del Consolidador de Finanzas: tabla `income_change_log`.
 * Una fila por cada modificación (editar costo, 2º a bordo, alta manual, corregir estatus).
 */
export class AddIncomeChangeLog1786000000068 implements MigrationInterface {
  name = 'AddIncomeChangeLog1786000000068';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('income_change_log')) return;
    await queryRunner.createTable(
      new Table({
        name: 'income_change_log',
        columns: [
          { name: 'id', type: 'char', length: '36', isPrimary: true },
          { name: 'incomeId', type: 'char', length: '36', isNullable: true },
          { name: 'shipmentId', type: 'char', length: '36', isNullable: true },
          { name: 'action', type: 'varchar', length: '40' },
          { name: 'field', type: 'varchar', length: '60', isNullable: true },
          { name: 'oldValue', type: 'varchar', length: '255', isNullable: true },
          { name: 'newValue', type: 'varchar', length: '255', isNullable: true },
          { name: 'reason', type: 'varchar', length: '255', isNullable: true },
          { name: 'userId', type: 'char', length: '36', isNullable: true },
          { name: 'createdAt', type: 'datetime', default: 'CURRENT_TIMESTAMP' },
        ],
        indices: [{ name: 'IDX_income_change_log_incomeId', columnNames: ['incomeId'] }],
      }),
      true,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('income_change_log')) {
      await queryRunner.dropTable('income_change_log');
    }
  }
}

import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Auditoría de rollback (superadmin) para operaciones de bodega. Marca la
 * operación como revertida sin borrarla: `rolledBack` + quién/cuándo. Aplica a
 * `warehouse_outbound` (traspaso/despacho) y `warehouse_receiving` (entrada).
 */
export class AddWarehouseOpsRollback1786000000036 implements MigrationInterface {
  name = 'AddWarehouseOpsRollback1786000000036'

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['warehouse_outbound', 'warehouse_receiving']) {
      await queryRunner.query(`
        ALTER TABLE \`${table}\`
        ADD \`rolledBack\` tinyint(1) NOT NULL DEFAULT 0,
        ADD \`rolledBackById\` varchar(36) NULL,
        ADD \`rolledBackAt\` datetime NULL
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['warehouse_outbound', 'warehouse_receiving']) {
      await queryRunner.query(`
        ALTER TABLE \`${table}\`
        DROP COLUMN \`rolledBackAt\`,
        DROP COLUMN \`rolledBackById\`,
        DROP COLUMN \`rolledBack\`
      `);
    }
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Anulación de ingresos (soft): cuando una devolución en el sistema regresa a FedEx un paquete
 * que ya había generado ingreso `entregado`, el original se marca inactivo y se crea una fila de
 * reversa (−cost) ligada por `reversalOfIncomeId`. Ambas quedan `active=0` → los reportes que
 * suman netean a 0 (incluyan o no inactivos) y los que cuentan por fila filtran `active=1`.
 *  - active            : soft-delete (original y reversa quedan 0).
 *  - annulledAt        : cuándo se anuló el original.
 *  - annulledById      : quién lo anuló (usuario de la devolución).
 *  - reversalOfIncomeId: liga la fila de reversa con el ingreso original que anula.
 */
export class AddIncomeAnnulment1786000000064 implements MigrationInterface {
  name = 'AddIncomeAnnulment1786000000064';

  private async columnExists(qr: QueryRunner, table: string, column: string): Promise<boolean> {
    const rows = await qr.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column],
    );
    return Number(rows[0].c) > 0;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await this.columnExists(queryRunner, 'income', 'active'))) {
      await queryRunner.query(`ALTER TABLE \`income\` ADD COLUMN \`active\` tinyint(1) NOT NULL DEFAULT 1`);
    }
    if (!(await this.columnExists(queryRunner, 'income', 'annulledAt'))) {
      await queryRunner.query(`ALTER TABLE \`income\` ADD COLUMN \`annulledAt\` datetime NULL`);
    }
    if (!(await this.columnExists(queryRunner, 'income', 'annulledById'))) {
      await queryRunner.query(`ALTER TABLE \`income\` ADD COLUMN \`annulledById\` char(36) NULL`);
    }
    if (!(await this.columnExists(queryRunner, 'income', 'reversalOfIncomeId'))) {
      await queryRunner.query(`ALTER TABLE \`income\` ADD COLUMN \`reversalOfIncomeId\` char(36) NULL`);
    }
    const idx = await queryRunner.query(
      `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'income' AND INDEX_NAME = 'IDX_income_reversal_of'`,
    );
    if (Number(idx[0].c) === 0) {
      await queryRunner.query(`CREATE INDEX \`IDX_income_reversal_of\` ON \`income\` (\`reversalOfIncomeId\`)`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const idx = await queryRunner.query(
      `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'income' AND INDEX_NAME = 'IDX_income_reversal_of'`,
    );
    if (Number(idx[0].c) > 0) await queryRunner.query(`DROP INDEX \`IDX_income_reversal_of\` ON \`income\``);
    for (const col of ['reversalOfIncomeId', 'annulledById', 'annulledAt', 'active']) {
      if (await this.columnExists(queryRunner, 'income', col)) {
        await queryRunner.query(`ALTER TABLE \`income\` DROP COLUMN \`${col}\``);
      }
    }
  }
}

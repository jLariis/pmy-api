import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Consolidador de Finanzas: auditoría de la edición in-place de `income`.
 * El consolidador edita el costo de un ingreso directamente sobre la fila (sin filas de reversa),
 * y deja una miga de auditoría:
 *  - originalCost : snapshot del `cost` antes del PRIMER ajuste (null = nunca editado).
 *  - updatedById  : usuario del último ajuste.
 *  - updatedAt    : momento del último ajuste.
 *  - editReason   : motivo del último ajuste (obligatorio en la request).
 */
export class AddIncomeConsolidadorAudit1786000000065 implements MigrationInterface {
  name = 'AddIncomeConsolidadorAudit1786000000065';

  private async columnExists(qr: QueryRunner, table: string, column: string): Promise<boolean> {
    const rows = await qr.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column],
    );
    return Number(rows[0].c) > 0;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await this.columnExists(queryRunner, 'income', 'originalCost'))) {
      await queryRunner.query(`ALTER TABLE \`income\` ADD COLUMN \`originalCost\` decimal(10,2) NULL`);
    }
    if (!(await this.columnExists(queryRunner, 'income', 'updatedById'))) {
      await queryRunner.query(`ALTER TABLE \`income\` ADD COLUMN \`updatedById\` char(36) NULL`);
    }
    if (!(await this.columnExists(queryRunner, 'income', 'updatedAt'))) {
      await queryRunner.query(`ALTER TABLE \`income\` ADD COLUMN \`updatedAt\` datetime NULL`);
    }
    if (!(await this.columnExists(queryRunner, 'income', 'editReason'))) {
      await queryRunner.query(`ALTER TABLE \`income\` ADD COLUMN \`editReason\` varchar(255) NULL`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const col of ['editReason', 'updatedAt', 'updatedById', 'originalCost']) {
      if (await this.columnExists(queryRunner, 'income', col)) {
        await queryRunner.query(`ALTER TABLE \`income\` DROP COLUMN \`${col}\``);
      }
    }
  }
}

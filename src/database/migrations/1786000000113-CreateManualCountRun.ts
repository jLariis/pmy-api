import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Consolidador → Conteo manual: guarda los TOTALES de cada comparación por sucursal (no las
 * listas pegadas) para que el Resumen muestre el último conteo de la semana.
 */
export class CreateManualCountRun1786000000113 implements MigrationInterface {
  name = 'CreateManualCountRun1786000000113';

  public async up(q: QueryRunner): Promise<void> {
    if (await q.hasTable('manual_count_run')) return;
    await q.query(
      `CREATE TABLE \`manual_count_run\` (
        \`id\` char(36) NOT NULL,
        \`subsidiaryId\` char(36) NOT NULL,
        \`scope\` varchar(8) NOT NULL,
        \`fromDay\` date NOT NULL,
        \`toDay\` date NOT NULL,
        \`counted\` int NOT NULL DEFAULT 0,
        \`matched\` int NOT NULL DEFAULT 0,
        \`differences\` int NOT NULL DEFAULT 0,
        \`missingAmount\` decimal(12,2) NOT NULL DEFAULT 0,
        \`extraAmount\` decimal(12,2) NOT NULL DEFAULT 0,
        \`createdById\` char(36) NULL,
        \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        INDEX \`IDX_manual_count_run_sub_to\` (\`subsidiaryId\`, \`toDay\`)
      ) ENGINE=InnoDB`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    if (await q.hasTable('manual_count_run')) await q.query('DROP TABLE `manual_count_run`');
  }
}

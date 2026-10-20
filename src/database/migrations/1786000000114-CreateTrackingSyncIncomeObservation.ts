import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Motor FedEx nuevo → sombra de COBROS: guarda guía por guía los ingresos que el motor propondría
 * (sin escribir income) para medir la paridad de cobros contra el legacy durante el piloto (Cabo).
 */
export class CreateTrackingSyncIncomeObservation1786000000114 implements MigrationInterface {
  name = 'CreateTrackingSyncIncomeObservation1786000000114';

  public async up(q: QueryRunner): Promise<void> {
    if (await q.hasTable('tracking_sync_income_observation')) return;
    await q.query(
      `CREATE TABLE \`tracking_sync_income_observation\` (
        \`id\` varchar(36) NOT NULL,
        \`runId\` char(36) NOT NULL,
        \`shipmentId\` char(36) NULL,
        \`subsidiaryId\` char(36) NULL,
        \`trackingNumber\` varchar(255) NOT NULL,
        \`incomeType\` varchar(32) NOT NULL,
        \`exceptionCode\` varchar(16) NULL,
        \`cost\` decimal(10,2) NOT NULL DEFAULT 0,
        \`occurredAt\` datetime NOT NULL,
        \`sourceEventKey\` varchar(120) NULL,
        \`alreadyExists\` tinyint NOT NULL DEFAULT 0,
        \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        INDEX \`IDX_tsio_run\` (\`runId\`),
        INDEX \`IDX_tsio_tracking_created\` (\`trackingNumber\`, \`createdAt\`)
      ) ENGINE=InnoDB`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    if (await q.hasTable('tracking_sync_income_observation')) await q.query('DROP TABLE `tracking_sync_income_observation`');
  }
}

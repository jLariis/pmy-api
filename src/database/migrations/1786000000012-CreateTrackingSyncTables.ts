import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tablas del motor de sincronización de tracking (shadow mode).
 * NO toca shipment_status ni shipment. Solo crea las tablas propias del motor.
 */
export class CreateTrackingSyncTables1786000000012 implements MigrationInterface {
  name = 'CreateTrackingSyncTables1786000000012';

  public async up(q: QueryRunner): Promise<void> {
    if (!(await q.hasTable('tracking_sync_run'))) {
      await q.query(`
        CREATE TABLE \`tracking_sync_run\` (
          \`id\` CHAR(36) NOT NULL,
          \`startedAt\` DATETIME NOT NULL,
          \`finishedAt\` DATETIME NULL,
          \`mode\` VARCHAR(16) NOT NULL DEFAULT 'shadow',
          \`total\` INT NOT NULL DEFAULT 0,
          \`ok\` INT NOT NULL DEFAULT 0,
          \`noData\` INT NOT NULL DEFAULT 0,
          \`failed\` INT NOT NULL DEFAULT 0,
          \`aborted\` TINYINT(1) NOT NULL DEFAULT 0,
          \`matchesLegacy\` INT NOT NULL DEFAULT 0,
          \`divergesLegacy\` INT NOT NULL DEFAULT 0,
          \`notes\` TEXT NULL,
          PRIMARY KEY (\`id\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    }

    if (!(await q.hasTable('tracking_sync_observation'))) {
      await q.query(`
        CREATE TABLE \`tracking_sync_observation\` (
          \`id\` CHAR(36) NOT NULL,
          \`runId\` CHAR(36) NOT NULL,
          \`shipmentId\` CHAR(36) NOT NULL,
          \`trackingNumber\` VARCHAR(255) NOT NULL,
          \`proposedStatus\` VARCHAR(64) NULL,
          \`legacyCurrentStatus\` VARCHAR(64) NULL,
          \`wouldInsertEvents\` INT NOT NULL DEFAULT 0,
          \`wouldInsertEventKeys\` TEXT NULL,
          \`matchesLegacy\` TINYINT(1) NOT NULL DEFAULT 0,
          \`issues\` TEXT NULL,
          \`createdAt\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (\`id\`),
          UNIQUE KEY \`uq_run_shipment\` (\`runId\`, \`shipmentId\`),
          KEY \`idx_obs_run\` (\`runId\`),
          KEY \`idx_obs_shipment\` (\`shipmentId\`),
          KEY \`idx_obs_tracking\` (\`trackingNumber\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE IF EXISTS `tracking_sync_observation`');
    await q.query('DROP TABLE IF EXISTS `tracking_sync_run`');
  }
}

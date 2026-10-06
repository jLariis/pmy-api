import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Acciones sobre consolidado con autorización (borrar corregido, cambiar sucursal, cambiar
 * fecha) y su bitácora:
 *  - `charge.active`: la carga F2 también se da de baja al borrar el consolidado.
 *  - `approval_request`: justificación, payload (sucursal/fecha nueva), llave de familia
 *    (consNumber|sucursal), impacto al aplicar, resultado y error de ejecución.
 *  - `consolidated_change_log`: una fila por cada registro cambiado (antes → después).
 */
export class ConsolidatedActions1786000000093 implements MigrationInterface {
  name = 'ConsolidatedActions1786000000093';

  public async up(q: QueryRunner): Promise<void> {
    if (!(await q.hasColumn('charge', 'active'))) {
      await q.query('ALTER TABLE `charge` ADD `active` tinyint(1) NOT NULL DEFAULT 1');
    }

    if (!(await q.hasColumn('approval_request', 'justification'))) {
      await q.query(
        'ALTER TABLE `approval_request` ' +
          'ADD `justification` text NULL, ' +
          'ADD `payload` json NULL, ' +
          'ADD `targetKey` varchar(160) NULL, ' +
          'ADD `targetLabel` varchar(255) NULL, ' +
          'ADD `impactAfter` json NULL, ' +
          'ADD `resultSummary` json NULL, ' +
          'ADD `executedAt` datetime NULL, ' +
          'ADD `executionError` text NULL',
      );
      await q.query('CREATE INDEX `IDX_approval_request_targetKey` ON `approval_request` (`targetKey`)');
    }

    if (!(await q.hasTable('consolidated_change_log'))) {
      await q.query(`
        CREATE TABLE \`consolidated_change_log\` (
          \`id\` varchar(36) NOT NULL,
          \`approvalRequestId\` char(36) NULL,
          \`action\` varchar(40) NOT NULL,
          \`consNumber\` varchar(255) NULL,
          \`entityType\` varchar(30) NOT NULL,
          \`entityId\` varchar(36) NOT NULL,
          \`trackingNumber\` varchar(255) NULL,
          \`field\` varchar(60) NOT NULL,
          \`oldValue\` varchar(255) NULL,
          \`newValue\` varchar(255) NULL,
          \`userId\` char(36) NULL,
          \`userName\` varchar(255) NULL,
          \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (\`id\`),
          INDEX \`IDX_ccl_request\` (\`approvalRequestId\`),
          INDEX \`IDX_ccl_cons\` (\`consNumber\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    if (await q.hasTable('consolidated_change_log')) await q.query('DROP TABLE `consolidated_change_log`');
    if (await q.hasColumn('approval_request', 'justification')) {
      await q.query('DROP INDEX `IDX_approval_request_targetKey` ON `approval_request`');
      await q.query(
        'ALTER TABLE `approval_request` DROP COLUMN `justification`, DROP COLUMN `payload`, DROP COLUMN `targetKey`, ' +
          'DROP COLUMN `targetLabel`, DROP COLUMN `impactAfter`, DROP COLUMN `resultSummary`, DROP COLUMN `executedAt`, DROP COLUMN `executionError`',
      );
    }
    if (await q.hasColumn('charge', 'active')) await q.query('ALTER TABLE `charge` DROP COLUMN `active`');
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';
import { randomUUID } from 'crypto';

/**
 * Alertas operativas (fase 4 de la bandeja): configuración global, configuración por
 * sucursal (pasos aplicables, encargados, WhatsApp) y las alertas con su escalamiento.
 * La configuración global nace APAGADA (`enabled = 0`).
 */
export class CreateOpsAlerts1786000000090 implements MigrationInterface {
  name = 'CreateOpsAlerts1786000000090';

  private async exists(q: QueryRunner, t: string): Promise<boolean> {
    const r = await q.query('SELECT COUNT(*) AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [t]);
    return Number(r[0].c) > 0;
  }

  public async up(q: QueryRunner): Promise<void> {
    if (!(await this.exists(q, 'ops_alert_settings'))) {
      await q.query(`CREATE TABLE \`ops_alert_settings\` (
        \`id\` varchar(36) NOT NULL,
        \`enabled\` tinyint(1) NOT NULL DEFAULT 0,
        \`uploadMinutes\` int NOT NULL DEFAULT 30,
        \`unloadingTime\` varchar(5) NOT NULL DEFAULT '21:00',
        \`dispatchTime\` varchar(5) NOT NULL DEFAULT '10:00',
        \`closureTime\` varchar(5) NOT NULL DEFAULT '21:00',
        \`inventoryTime\` varchar(5) NOT NULL DEFAULT '19:00',
        \`escalate1Min\` int NOT NULL DEFAULT 30,
        \`escalate2Min\` int NOT NULL DEFAULT 60,
        \`completePct\` int NOT NULL DEFAULT 100,
        \`lookbackDays\` int NOT NULL DEFAULT 3,
        \`activeFrom\` varchar(5) NOT NULL DEFAULT '06:00',
        \`activeTo\` varchar(5) NOT NULL DEFAULT '21:30',
        \`enabledAt\` datetime NULL,
        \`updatedById\` varchar(36) NULL,
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      await q.query('INSERT INTO `ops_alert_settings` (`id`) VALUES (?)', [randomUUID()]);
    }

    if (!(await this.exists(q, 'ops_alert_subsidiary'))) {
      await q.query(`CREATE TABLE \`ops_alert_subsidiary\` (
        \`subsidiaryId\` varchar(36) NOT NULL,
        \`stepUpload\` tinyint(1) NOT NULL DEFAULT 1,
        \`stepUnloading\` tinyint(1) NOT NULL DEFAULT 1,
        \`stepDispatch\` tinyint(1) NOT NULL DEFAULT 1,
        \`stepClosure\` tinyint(1) NOT NULL DEFAULT 1,
        \`stepInventory\` tinyint(1) NOT NULL DEFAULT 1,
        \`managerUserIds\` json NULL,
        \`whatsappNumbers\` json NULL,
        \`whatsappGroups\` json NULL,
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`subsidiaryId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    }

    if (!(await this.exists(q, 'ops_alert'))) {
      await q.query(`CREATE TABLE \`ops_alert\` (
        \`id\` varchar(36) NOT NULL,
        \`subsidiaryId\` varchar(36) NOT NULL,
        \`step\` varchar(12) NOT NULL,
        \`refKey\` varchar(80) NOT NULL,
        \`inboxConsolidationId\` varchar(36) NULL,
        \`consNumber\` varchar(30) NULL,
        \`dueAt\` datetime NOT NULL,
        \`level\` tinyint NOT NULL DEFAULT 0,
        \`notifiedAt\` datetime NULL,
        \`progressPct\` int NOT NULL DEFAULT 0,
        \`resolvedAt\` datetime NULL,
        \`lateMinutes\` int NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`UQ_ops_alert_step_ref\` (\`step\`, \`refKey\`),
        KEY \`IDX_ops_alert_open\` (\`resolvedAt\`, \`subsidiaryId\`),
        KEY \`IDX_ops_alert_cons\` (\`inboxConsolidationId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const t of ['ops_alert', 'ops_alert_subsidiary', 'ops_alert_settings']) {
      if (await this.exists(q, t)) await q.query(`DROP TABLE \`${t}\``);
    }
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bandeja de correo FedEx (sistemas@): correos, adjuntos, detecciones, consolidados
 * anunciados (recibido vs subido), pistas aprendidas, avance de lectura IMAP y la
 * cobertura de códigos postales por sucursal.
 */
export class CreateInbox1786000000086 implements MigrationInterface {
  name = 'CreateInbox1786000000086';

  private async tableExists(q: QueryRunner, table: string): Promise<boolean> {
    const rows = await q.query(
      `SELECT COUNT(*) AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [table],
    );
    return Number(rows[0].c) > 0;
  }

  private async create(q: QueryRunner, table: string, ddl: string): Promise<void> {
    if (!(await this.tableExists(q, table))) {
      await q.query(`CREATE TABLE \`${table}\` (${ddl}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    }
  }

  public async up(q: QueryRunner): Promise<void> {
    await this.create(q, 'inbox_message', `
      \`id\` varchar(36) NOT NULL,
      \`mailbox\` varchar(120) NOT NULL DEFAULT 'INBOX',
      \`uidValidity\` bigint NOT NULL,
      \`uid\` int NOT NULL,
      \`messageId\` varchar(500) NOT NULL,
      \`fromAddress\` varchar(320) NOT NULL,
      \`fromName\` varchar(255) NULL,
      \`toAddresses\` json NULL,
      \`ccAddresses\` json NULL,
      \`subject\` varchar(998) NOT NULL DEFAULT '',
      \`receivedAt\` datetime NOT NULL,
      \`textTop\` mediumtext NULL,
      \`htmlSafe\` mediumtext NULL,
      \`hasQuotedHistory\` tinyint(1) NOT NULL DEFAULT 0,
      \`status\` varchar(20) NOT NULL DEFAULT 'nuevo',
      \`ignoreReason\` varchar(255) NULL,
      \`errorMessage\` text NULL,
      \`attempts\` int NOT NULL DEFAULT 0,
      \`subsidiaryId\` varchar(36) NULL,
      \`confirmedById\` varchar(36) NULL,
      \`confirmedAt\` datetime NULL,
      \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`UQ_inbox_message_uid\` (\`mailbox\`, \`uidValidity\`, \`uid\`),
      UNIQUE KEY \`UQ_inbox_message_messageId\` (\`messageId\`),
      KEY \`IDX_inbox_message_receivedAt\` (\`receivedAt\`),
      KEY \`IDX_inbox_message_status\` (\`status\`),
      KEY \`IDX_inbox_message_subsidiaryId\` (\`subsidiaryId\`)
    `);

    await this.create(q, 'inbox_attachment', `
      \`id\` varchar(36) NOT NULL,
      \`inboxMessageId\` varchar(36) NOT NULL,
      \`filename\` varchar(255) NOT NULL,
      \`contentType\` varchar(150) NOT NULL DEFAULT 'application/octet-stream',
      \`size\` int NOT NULL DEFAULT 0,
      \`sha256\` char(64) NOT NULL,
      \`storagePath\` varchar(500) NOT NULL,
      \`kind\` varchar(20) NOT NULL DEFAULT 'other',
      \`kindSource\` varchar(10) NOT NULL DEFAULT 'nombre',
      \`consNumber\` varchar(30) NULL,
      \`rowCount\` int NULL,
      \`zipSummary\` json NULL,
      \`citySummary\` json NULL,
      \`parseError\` varchar(255) NULL,
      PRIMARY KEY (\`id\`),
      KEY \`IDX_inbox_attachment_message\` (\`inboxMessageId\`),
      KEY \`IDX_inbox_attachment_cons\` (\`consNumber\`)
    `);

    await this.create(q, 'inbox_detection', `
      \`id\` varchar(36) NOT NULL,
      \`inboxMessageId\` varchar(36) NOT NULL,
      \`subsidiaryId\` varchar(36) NULL,
      \`confidence\` decimal(5,3) NOT NULL DEFAULT 0,
      \`autoSafe\` tinyint(1) NOT NULL DEFAULT 0,
      \`signals\` json NOT NULL,
      \`runnerUp\` json NULL,
      \`reason\` varchar(500) NOT NULL DEFAULT '',
      \`detectorVersion\` int NOT NULL DEFAULT 1,
      \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      PRIMARY KEY (\`id\`),
      KEY \`IDX_inbox_detection_message\` (\`inboxMessageId\`)
    `);

    await this.create(q, 'inbox_consolidation', `
      \`id\` varchar(36) NOT NULL,
      \`inboxMessageId\` varchar(36) NOT NULL,
      \`consNumber\` varchar(30) NOT NULL,
      \`kind\` varchar(15) NOT NULL,
      \`subsidiaryId\` varchar(36) NULL,
      \`announcedCount\` int NULL,
      \`cobros\` json NULL,
      \`receivedAt\` datetime NOT NULL,
      \`uploadedAt\` datetime NULL,
      \`uploadedById\` varchar(36) NULL,
      \`uploadedVia\` varchar(10) NULL,
      \`uploadMinutes\` int NULL,
      \`linkStatus\` varchar(12) NOT NULL DEFAULT 'pendiente',
      \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`UQ_inbox_consolidation_cons_kind\` (\`consNumber\`, \`kind\`),
      KEY \`IDX_inbox_consolidation_message\` (\`inboxMessageId\`),
      KEY \`IDX_inbox_consolidation_subsidiary\` (\`subsidiaryId\`),
      KEY \`IDX_inbox_consolidation_received\` (\`receivedAt\`),
      KEY \`IDX_inbox_consolidation_link\` (\`linkStatus\`)
    `);

    await this.create(q, 'inbox_signal_alias', `
      \`id\` varchar(36) NOT NULL,
      \`signalType\` varchar(12) NOT NULL,
      \`term\` varchar(320) NOT NULL,
      \`subsidiaryId\` varchar(36) NOT NULL,
      \`hits\` int NOT NULL DEFAULT 0,
      \`misses\` int NOT NULL DEFAULT 0,
      \`source\` varchar(12) NOT NULL DEFAULT 'confirmacion',
      \`lastSeenAt\` datetime NULL,
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`UQ_inbox_signal_alias\` (\`signalType\`, \`term\`, \`subsidiaryId\`)
    `);

    await this.create(q, 'inbox_sync_state', `
      \`id\` varchar(36) NOT NULL,
      \`mailbox\` varchar(120) NOT NULL,
      \`uidValidity\` bigint NULL,
      \`lastUid\` int NOT NULL DEFAULT 0,
      \`lastRunAt\` datetime NULL,
      \`lastOkAt\` datetime NULL,
      \`lastError\` text NULL,
      \`enabled\` tinyint(1) NOT NULL DEFAULT 0,
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`UQ_inbox_sync_state_mailbox\` (\`mailbox\`)
    `);

    await this.create(q, 'subsidiary_zip_coverage', `
      \`id\` varchar(36) NOT NULL,
      \`zip\` varchar(10) NOT NULL,
      \`subsidiaryId\` varchar(36) NOT NULL,
      \`city\` varchar(150) NULL,
      \`state\` varchar(100) NULL,
      \`shipmentCount\` int NOT NULL DEFAULT 0,
      \`share\` decimal(5,4) NOT NULL DEFAULT 0,
      \`source\` varchar(10) NOT NULL DEFAULT 'historial',
      \`status\` varchar(10) NOT NULL DEFAULT 'sugerido',
      \`firstSeenAt\` datetime NULL,
      \`lastSeenAt\` datetime NULL,
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`UQ_subsidiary_zip_coverage\` (\`zip\`, \`subsidiaryId\`),
      KEY \`IDX_subsidiary_zip_coverage_zip\` (\`zip\`),
      KEY \`IDX_subsidiary_zip_coverage_sub\` (\`subsidiaryId\`)
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const t of [
      'subsidiary_zip_coverage',
      'inbox_sync_state',
      'inbox_signal_alias',
      'inbox_consolidation',
      'inbox_detection',
      'inbox_attachment',
      'inbox_message',
    ]) {
      if (await this.tableExists(q, t)) await q.query(`DROP TABLE \`${t}\``);
    }
  }
}

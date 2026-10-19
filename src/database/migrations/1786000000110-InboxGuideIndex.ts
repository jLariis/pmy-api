import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Buscador de Correos: qué guías trae cada correo (por archivo y hoja), para encontrar en qué correo
 * llegó una guía aunque nunca se haya subido. `inbox_message.guidesIndexedAt` marca los correos ya
 * leídos; un cron llena los pendientes (los viejos se indexan solos poco a poco).
 */
export class InboxGuideIndex1786000000110 implements MigrationInterface {
  name = 'InboxGuideIndex1786000000110';

  public async up(q: QueryRunner): Promise<void> {
    if (!(await q.hasTable('inbox_guide'))) {
      await q.query(
        `CREATE TABLE \`inbox_guide\` (
          \`id\` bigint NOT NULL AUTO_INCREMENT,
          \`inboxMessageId\` varchar(36) NOT NULL,
          \`inboxAttachmentId\` varchar(36) NULL,
          \`sheet\` varchar(100) NULL,
          \`unitKind\` varchar(15) NOT NULL,
          \`unitConsNumber\` varchar(30) NULL,
          \`trackingNumber\` varchar(40) NOT NULL,
          PRIMARY KEY (\`id\`),
          INDEX \`IDX_inbox_guide_tracking\` (\`trackingNumber\`),
          INDEX \`IDX_inbox_guide_message\` (\`inboxMessageId\`)
        ) ENGINE=InnoDB`,
      );
    }
    if (!(await q.hasColumn('inbox_message', 'guidesIndexedAt'))) {
      await q.query('ALTER TABLE `inbox_message` ADD `guidesIndexedAt` datetime NULL');
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    if (await q.hasColumn('inbox_message', 'guidesIndexedAt')) await q.query('ALTER TABLE `inbox_message` DROP COLUMN `guidesIndexedAt`');
    if (await q.hasTable('inbox_guide')) await q.query('DROP TABLE `inbox_guide`');
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tabla `notification`: una fila por destinatario. El feed de la campana
 * (NotificationsService.getFeed) la lee junto con el feed legacy derivado de
 * auditoría durante la transición (flag NOTIFICATIONS_LEGACY_FEED). Columnas
 * espejo de `src/entities/notification.entity.ts`.
 */
export class CreateNotification1786000000031 implements MigrationInterface {
  name = 'CreateNotification1786000000031';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS \`notification\` (
        \`id\`            CHAR(36)     NOT NULL,
        \`recipientId\`   CHAR(36)     NOT NULL,
        \`type\`          VARCHAR(80)  NOT NULL,
        \`category\`      VARCHAR(20)  NOT NULL DEFAULT 'operacion',
        \`title\`         VARCHAR(200) NOT NULL,
        \`body\`          TEXT         NULL,
        \`icon\`          VARCHAR(60)  NULL,
        \`severity\`      VARCHAR(20)  NOT NULL DEFAULT 'info',
        \`link\`          VARCHAR(300) NULL,
        \`entityId\`      VARCHAR(64)  NULL,
        \`subsidiaryId\`  CHAR(36)     NULL,
        \`actorId\`       CHAR(36)     NULL,
        \`actorName\`     VARCHAR(160) NULL,
        \`read\`          TINYINT(1)   NOT NULL DEFAULT 0,
        \`readAt\`        DATETIME     NULL,
        \`createdAt\`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        KEY \`idx_notification_recipient_read\` (\`recipientId\`, \`read\`),
        KEY \`idx_notification_recipient_createdAt\` (\`recipientId\`, \`createdAt\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE IF EXISTS `notification`');
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';
import { randomUUID } from 'crypto';
import { DEFAULT_DRIVER_PHONE, DEFAULT_MESSAGE_TEMPLATE } from '../../whatsapp-settings/whatsapp-defaults';

/**
 * Config de avisos por WhatsApp al chofer (singleton). Crea la tabla y siembra
 * UNA fila con el número por defecto y la plantilla del mensaje.
 */
export class AddWhatsappSettings1786000000027 implements MigrationInterface {
  name = 'AddWhatsappSettings1786000000027';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS \`whatsapp_settings\` (
        \`id\`              VARCHAR(36)  NOT NULL,
        \`enabled\`         TINYINT(1)   NOT NULL DEFAULT 1,
        \`driverPhone\`     VARCHAR(30)  NOT NULL DEFAULT '',
        \`messageTemplate\` TEXT         NOT NULL,
        \`updatedAt\`       DATETIME     NULL,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    const rows: any[] = await q.query(`SELECT COUNT(*) AS c FROM \`whatsapp_settings\``);
    if (Number(rows?.[0]?.c ?? 0) === 0) {
      await q.query(
        `INSERT INTO \`whatsapp_settings\` (\`id\`, \`enabled\`, \`driverPhone\`, \`messageTemplate\`) VALUES (?, 1, ?, ?)`,
        [randomUUID(), DEFAULT_DRIVER_PHONE, DEFAULT_MESSAGE_TEMPLATE],
      );
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS \`whatsapp_settings\``);
  }
}

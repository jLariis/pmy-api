import { MigrationInterface, QueryRunner } from 'typeorm';
import { randomUUID } from 'crypto';
import { WHATSAPP_TEMPLATE_DEFAULTS } from '../../whatsapp-templates/whatsapp-template-defaults';

/**
 * Crea whatsapp_templates y siembra las plantillas por defecto. Migra el
 * messageTemplate editado (si existe) a 'prioridad_entrega'. Luego elimina las
 * columnas driverPhone/messageTemplate de whatsapp_settings (el número ahora se
 * elige al enviar).
 */
export class WhatsappTemplatesAndSettingsCleanup1786000000034 implements MigrationInterface {
  name = 'WhatsappTemplatesAndSettingsCleanup1786000000034';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS \`whatsapp_templates\` (
        \`id\`        VARCHAR(36)  NOT NULL,
        \`key\`       VARCHAR(64)  NOT NULL,
        \`name\`      VARCHAR(191) NOT NULL,
        \`body\`      TEXT         NOT NULL,
        \`active\`    TINYINT(1)   NOT NULL DEFAULT 1,
        \`updatedAt\` DATETIME     NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`UQ_whatsapp_templates_key\` (\`key\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Migrar el mensaje editado (si la columna aún existe) a 'prioridad_entrega'.
    let editedBody: string | null = null;
    try {
      const rows: any[] = await q.query(`SELECT \`messageTemplate\` AS b FROM \`whatsapp_settings\` LIMIT 1`);
      editedBody = rows?.[0]?.b ?? null;
    } catch { /* columna ya no existe: ok */ }

    for (const def of WHATSAPP_TEMPLATE_DEFAULTS) {
      const exists: any[] = await q.query(`SELECT id FROM \`whatsapp_templates\` WHERE \`key\` = ?`, [def.key]);
      if (exists.length) continue;
      const body = def.key === 'prioridad_entrega' && editedBody ? editedBody : def.body;
      await q.query(
        `INSERT INTO \`whatsapp_templates\` (\`id\`, \`key\`, \`name\`, \`body\`, \`active\`, \`updatedAt\`) VALUES (?, ?, ?, ?, 1, NOW())`,
        [randomUUID(), def.key, def.name, body],
      );
    }

    // Soltar columnas obsoletas de whatsapp_settings (tolerante si ya no están).
    for (const col of ['driverPhone', 'messageTemplate']) {
      try { await q.query(`ALTER TABLE \`whatsapp_settings\` DROP COLUMN \`${col}\``); } catch { /* ya eliminada */ }
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE \`whatsapp_settings\` ADD COLUMN \`driverPhone\` VARCHAR(30) NOT NULL DEFAULT ''`);
    await q.query(`ALTER TABLE \`whatsapp_settings\` ADD COLUMN \`messageTemplate\` TEXT NULL`);
    await q.query(`DROP TABLE IF EXISTS \`whatsapp_templates\``);
  }
}

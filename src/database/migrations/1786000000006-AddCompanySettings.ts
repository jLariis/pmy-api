import { MigrationInterface, QueryRunner } from 'typeorm';
import { randomUUID } from 'crypto';

/**
 * Datos de empresa (singleton). Crea la tabla y siembra UNA fila con los valores
 * que antes estaban hardcodeados en la pantalla de Configuración.
 */
export class AddCompanySettings1786000000006 implements MigrationInterface {
  name = 'AddCompanySettings1786000000006';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS \`company_settings\` (
        \`id\`        VARCHAR(36)  NOT NULL,
        \`name\`      VARCHAR(255) NOT NULL DEFAULT '',
        \`taxId\`     VARCHAR(50)  NOT NULL DEFAULT '',
        \`address\`   VARCHAR(255) NOT NULL DEFAULT '',
        \`phone\`     VARCHAR(50)  NOT NULL DEFAULT '',
        \`email\`     VARCHAR(150) NOT NULL DEFAULT '',
        \`website\`   VARCHAR(150) NOT NULL DEFAULT '',
        \`updatedAt\` DATETIME     NULL,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    const rows: any[] = await q.query(`SELECT COUNT(*) AS c FROM \`company_settings\``);
    if (Number(rows?.[0]?.c ?? 0) === 0) {
      await q.query(
        `INSERT INTO \`company_settings\` (\`id\`, \`name\`, \`taxId\`, \`address\`, \`phone\`, \`email\`, \`website\`) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          randomUUID(),
          'Paquetería & Mensajería Del Yaqui',
          'PMY123456ABC',
          'Calle Principal #123, Ciudad Obregón, Sonora',
          '(644) 123-4567',
          'contacto@delyaqui.com',
          'www.delyaqui.com',
        ],
      );
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS \`company_settings\``);
  }
}

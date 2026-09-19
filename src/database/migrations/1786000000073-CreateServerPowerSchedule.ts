import { MigrationInterface, QueryRunner } from 'typeorm';
import { randomUUID } from 'crypto';

/**
 * Suspensión/despertar programado del servidor.
 *  - `server_power_schedule` (fila única): enabled + horas + recipients + trazabilidad de apply.
 *  - `server_power_day` (7 filas, una por día ISO 1..7): flag `active` por noche.
 * Siembra: settings default (21:30 / 06:00 / 3 correos), días 1–6 activos, 7 inactivo.
 */
export class CreateServerPowerSchedule1786000000073 implements MigrationInterface {
  name = 'CreateServerPowerSchedule1786000000073';

  private async tableExists(qr: QueryRunner, table: string): Promise<boolean> {
    const rows = await qr.query(
      `SELECT COUNT(*) AS c FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [table],
    );
    return Number(rows[0].c) > 0;
  }

  public async up(qr: QueryRunner): Promise<void> {
    if (!(await this.tableExists(qr, 'server_power_schedule'))) {
      await qr.query(`
        CREATE TABLE \`server_power_schedule\` (
          \`id\` varchar(36) NOT NULL,
          \`enabled\` tinyint(1) NOT NULL DEFAULT 1,
          \`suspendTime\` varchar(5) NOT NULL DEFAULT '21:30',
          \`wakeTime\` varchar(5) NOT NULL DEFAULT '06:00',
          \`recipients\` json NULL,
          \`lastAppliedAt\` datetime NULL,
          \`lastApplyError\` text NULL,
          \`updatedById\` varchar(36) NULL,
          \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
          \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
          PRIMARY KEY (\`id\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    }

    const schedCount = await qr.query(`SELECT COUNT(*) AS c FROM \`server_power_schedule\``);
    if (Number(schedCount[0].c) === 0) {
      const recipients = JSON.stringify([
        'javier.rappaz@gmail.com',
        'josejuanurena@paqueteriaymensajeriadelyaqui.com',
        'sistemas@paqueteriaymensajeriadelyaqui.com',
      ]);
      await qr.query(
        `INSERT INTO \`server_power_schedule\`
           (\`id\`, \`enabled\`, \`suspendTime\`, \`wakeTime\`, \`recipients\`)
         VALUES (?, 1, '21:30', '06:00', ?)`,
        [randomUUID(), recipients],
      );
    }

    if (!(await this.tableExists(qr, 'server_power_day'))) {
      await qr.query(`
        CREATE TABLE \`server_power_day\` (
          \`id\` varchar(36) NOT NULL,
          \`dayOfWeek\` tinyint NOT NULL,
          \`active\` tinyint(1) NOT NULL DEFAULT 1,
          PRIMARY KEY (\`id\`),
          UNIQUE KEY \`UQ_server_power_day_dow\` (\`dayOfWeek\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    }

    const dayCount = await qr.query(`SELECT COUNT(*) AS c FROM \`server_power_day\``);
    if (Number(dayCount[0].c) === 0) {
      for (let dow = 1; dow <= 7; dow++) {
        await qr.query(
          `INSERT INTO \`server_power_day\` (\`id\`, \`dayOfWeek\`, \`active\`) VALUES (?, ?, ?)`,
          [randomUUID(), dow, dow <= 6 ? 1 : 0],
        );
      }
    }
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS \`server_power_day\``);
    await qr.query(`DROP TABLE IF EXISTS \`server_power_schedule\``);
  }
}

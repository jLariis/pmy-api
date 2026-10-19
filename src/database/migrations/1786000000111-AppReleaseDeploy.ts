import { MigrationInterface, QueryRunner } from 'typeorm';
import { randomUUID } from 'crypto';

/**
 * Actualizar el servidor + versiones + aviso de novedades (2026-10-18).
 *  - `app_release`: versión publicada del sistema (semilla 2.0.0).
 *  - `deploy_run`: historial del botón "Actualizar".
 *  - `user.lastSeenReleaseVersion`: última versión cuyo aviso vio cada usuario.
 *
 * DEFENSIVA: guards a information_schema (no falla si ya existen).
 */
export class AppReleaseDeploy1786000000111 implements MigrationInterface {
  name = 'AppReleaseDeploy1786000000111';

  private async tableExists(qr: QueryRunner, table: string): Promise<boolean> {
    const rows = await qr.query(
      `SELECT COUNT(*) AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [table],
    );
    return Number(rows[0].c) > 0;
  }

  private async columnExists(qr: QueryRunner, table: string, column: string): Promise<boolean> {
    const rows = await qr.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column],
    );
    return Number(rows[0].c) > 0;
  }

  public async up(qr: QueryRunner): Promise<void> {
    if (!(await this.tableExists(qr, 'app_release'))) {
      await qr.query(`
        CREATE TABLE \`app_release\` (
          \`id\` varchar(36) NOT NULL,
          \`version\` varchar(20) NOT NULL,
          \`bump\` varchar(10) NOT NULL,
          \`notes\` json NULL,
          \`publishedNoteIds\` json NULL,
          \`apiCommit\` varchar(40) NULL,
          \`webCommit\` varchar(40) NULL,
          \`publishedAt\` datetime NOT NULL,
          \`publishedById\` varchar(36) NULL,
          PRIMARY KEY (\`id\`),
          UNIQUE KEY \`UQ_app_release_version\` (\`version\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      await qr.query(
        `INSERT INTO \`app_release\` (id, version, bump, notes, publishedNoteIds, publishedAt) VALUES (?, '2.0.0', 'major', '[]', '[]', NOW())`,
        [randomUUID()],
      );
    }

    if (!(await this.tableExists(qr, 'deploy_run'))) {
      await qr.query(`
        CREATE TABLE \`deploy_run\` (
          \`id\` varchar(36) NOT NULL,
          \`status\` varchar(10) NOT NULL,
          \`step\` varchar(40) NULL,
          \`fromVersion\` varchar(20) NOT NULL,
          \`targetVersion\` varchar(20) NOT NULL,
          \`bump\` varchar(10) NOT NULL,
          \`notes\` json NULL,
          \`publishedNoteIds\` json NULL,
          \`fromApiCommit\` varchar(40) NULL,
          \`toApiCommit\` varchar(40) NULL,
          \`webCommit\` varchar(40) NULL,
          \`startedAt\` datetime NOT NULL,
          \`finishedAt\` datetime NULL,
          \`durationMs\` int NULL,
          \`startedById\` varchar(36) NULL,
          \`error\` text NULL,
          \`logPath\` varchar(255) NOT NULL,
          PRIMARY KEY (\`id\`),
          KEY \`IDX_deploy_run_status\` (\`status\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    }

    if (!(await this.columnExists(qr, 'user', 'lastSeenReleaseVersion'))) {
      await qr.query(`ALTER TABLE \`user\` ADD COLUMN \`lastSeenReleaseVersion\` varchar(20) NULL DEFAULT NULL`);
    }
  }

  public async down(qr: QueryRunner): Promise<void> {
    if (await this.columnExists(qr, 'user', 'lastSeenReleaseVersion')) {
      await qr.query(`ALTER TABLE \`user\` DROP COLUMN \`lastSeenReleaseVersion\``);
    }
    await qr.query(`DROP TABLE IF EXISTS \`deploy_run\``);
    await qr.query(`DROP TABLE IF EXISTS \`app_release\``);
  }
}

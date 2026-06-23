import { MigrationInterface, QueryRunner } from 'typeorm';
import { randomUUID } from 'crypto';
import { RBAC_ROLES, RBAC_PERMISSIONS, LEGACY_ROLE_MAP } from '../../auth/rbac/permission-catalog';

/**
 * RBAC Fase A: crea role / permission / role_permissions / user_permission,
 * agrega `user.roleId`, y SIEMBRA roles + permisos + asignaciones desde el
 * catálogo (`permission-catalog.ts`, derivado de allowed-page-roles del front).
 * Hace BACKFILL de `user.roleId` mapeando el `user.role` string con LEGACY_ROLE_MAP.
 *
 * Notas de robustez:
 * - Sin FK físico hacia `user` (la tabla `user` tiene otro charset/collation y MySQL
 *   rechaza el FK por ER_FK_INCOMPATIBLE_COLUMNS). Se usa FK suave (columna + índice),
 *   igual que `user.roleId`. Convención del proyecto (audit_log tampoco usa FKs).
 * - DDL con IF NOT EXISTS y seed idempotente (solo si `role` está vacía), porque el
 *   CREATE TABLE hace commit implícito en MySQL (re-correr no debe duplicar).
 */
export class AddRbacTables1786000000005 implements MigrationInterface {
  name = 'AddRbacTables1786000000005';

  public async up(q: QueryRunner): Promise<void> {
    // ----- 1. Tablas -----
    await q.query(`
      CREATE TABLE IF NOT EXISTS \`role\` (
        \`id\`          VARCHAR(36)  NOT NULL,
        \`key\`         VARCHAR(50)  NOT NULL,
        \`name\`        VARCHAR(100) NOT NULL,
        \`description\` VARCHAR(255) NULL,
        \`isSystem\`    TINYINT(1)   NOT NULL DEFAULT 0,
        \`createdAt\`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_role_key\` (\`key\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await q.query(`
      CREATE TABLE IF NOT EXISTS \`permission\` (
        \`id\`          VARCHAR(36)  NOT NULL,
        \`code\`        VARCHAR(100) NOT NULL,
        \`name\`        VARCHAR(150) NOT NULL,
        \`groupName\`   VARCHAR(100) NOT NULL DEFAULT '',
        \`description\` VARCHAR(255) NULL,
        \`createdAt\`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_permission_code\` (\`code\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await q.query(`
      CREATE TABLE IF NOT EXISTS \`role_permissions\` (
        \`roleId\`       VARCHAR(36) NOT NULL,
        \`permissionId\` VARCHAR(36) NOT NULL,
        PRIMARY KEY (\`roleId\`, \`permissionId\`),
        KEY \`idx_rp_permission\` (\`permissionId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await q.query(`
      CREATE TABLE IF NOT EXISTS \`user_permission\` (
        \`id\`           VARCHAR(36)            NOT NULL,
        \`userId\`       VARCHAR(36)            NOT NULL,
        \`permissionId\` VARCHAR(36)            NOT NULL,
        \`effect\`       ENUM('allow','deny')   NOT NULL DEFAULT 'allow',
        \`createdAt\`    DATETIME               NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_user_permission\` (\`userId\`, \`permissionId\`),
        KEY \`idx_up_user\` (\`userId\`),
        KEY \`idx_up_permission\` (\`permissionId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // ----- 2. user.roleId (FK suave: columna + índice) -----
    const userCols: any[] = await q.query(`SHOW COLUMNS FROM \`user\` LIKE 'roleId'`);
    if (userCols.length === 0) {
      await q.query(`ALTER TABLE \`user\` ADD COLUMN \`roleId\` VARCHAR(36) NULL`);
      await q.query(`ALTER TABLE \`user\` ADD KEY \`idx_user_roleId\` (\`roleId\`)`);
    }

    // ----- 3. Seed (idempotente: solo si `role` está vacía) -----
    const roleCountRows: any[] = await q.query(`SELECT COUNT(*) AS c FROM \`role\``);
    if (Number(roleCountRows?.[0]?.c ?? 0) === 0) {
      const rid: Record<string, string> = {};
      for (const r of RBAC_ROLES) {
        const id = randomUUID();
        rid[r.key] = id;
        await q.query(
          `INSERT INTO \`role\` (\`id\`, \`key\`, \`name\`, \`description\`, \`isSystem\`) VALUES (?, ?, ?, ?, ?)`,
          [id, r.key, r.name, r.description, r.isSystem ? 1 : 0],
        );
      }
      for (const p of RBAC_PERMISSIONS) {
        const pid = randomUUID();
        await q.query(
          `INSERT INTO \`permission\` (\`id\`, \`code\`, \`name\`, \`groupName\`, \`description\`) VALUES (?, ?, ?, ?, ?)`,
          [pid, p.code, p.name, p.groupName, ''],
        );
        for (const rk of p.roles) {
          if (rid[rk]) {
            await q.query(
              `INSERT INTO \`role_permissions\` (\`roleId\`, \`permissionId\`) VALUES (?, ?)`,
              [rid[rk], pid],
            );
          }
        }
      }
    }

    // ----- 4. Backfill user.roleId (siempre; carga ids de la BD) -----
    const roleRows: any[] = await q.query(`SELECT \`id\`, \`key\` FROM \`role\``);
    const roleIdByKey: Record<string, string> = {};
    for (const r of roleRows) roleIdByKey[r.key] = r.id;

    for (const [legacy, key] of Object.entries(LEGACY_ROLE_MAP)) {
      const id = roleIdByKey[key];
      if (id) {
        await q.query(`UPDATE \`user\` SET \`roleId\` = ? WHERE LOWER(\`role\`) = ?`, [id, legacy.toLowerCase()]);
      }
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    const cols: any[] = await q.query(`SHOW COLUMNS FROM \`user\` LIKE 'roleId'`);
    if (cols.length > 0) {
      await q.query(`ALTER TABLE \`user\` DROP KEY \`idx_user_roleId\``).catch(() => undefined);
      await q.query(`ALTER TABLE \`user\` DROP COLUMN \`roleId\``);
    }
    await q.query(`DROP TABLE IF EXISTS \`user_permission\``);
    await q.query(`DROP TABLE IF EXISTS \`role_permissions\``);
    await q.query(`DROP TABLE IF EXISTS \`permission\``);
    await q.query(`DROP TABLE IF EXISTS \`role\``);
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';
import { randomUUID } from 'crypto';
import { RBAC_PERMISSIONS } from '../../auth/rbac/permission-catalog';

/**
 * Edición de salidas a ruta + cierre agrupado:
 *  - Tabla `package_dispatch_change`: bitácora de guías agregadas/quitadas (quién, qué, por qué).
 *  - `route_closure.closureGroupId`: cierres hechos juntos (mismo chofer, mismo día).
 *  - Permiso `operaciones.salidas.editar` (solo superadmin por defecto; asignable por rol).
 *    Misma sincronización idempotente del catálogo que las migraciones Sync*Permission.
 */
export class PackageDispatchEditing1786000000118 implements MigrationInterface {
  name = 'PackageDispatchEditing1786000000118';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS \`package_dispatch_change\` (
        \`id\` varchar(36) NOT NULL,
        \`dispatchId\` char(36) NOT NULL,
        \`action\` varchar(8) NOT NULL,
        \`trackingNumber\` varchar(64) NOT NULL,
        \`shipmentId\` char(36) NULL,
        \`chargeShipmentId\` char(36) NULL,
        \`previousStatus\` varchar(64) NULL,
        \`newStatus\` varchar(64) NULL,
        \`reason\` varchar(500) NOT NULL,
        \`createdById\` char(36) NULL,
        \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        INDEX \`IDX_dispatch_change_dispatch\` (\`dispatchId\`, \`createdAt\`)
      ) ENGINE=InnoDB`);

    const col: any[] = await q.query("SHOW COLUMNS FROM `route_closure` LIKE 'closureGroupId'");
    if (col.length === 0) {
      await q.query('ALTER TABLE `route_closure` ADD COLUMN `closureGroupId` CHAR(36) NULL');
      await q.query('CREATE INDEX `IDX_route_closure_group` ON `route_closure` (`closureGroupId`)');
    }

    const roleRows: any[] = await q.query('SELECT `id`, `key` FROM `role`');
    const roleId: Record<string, string> = {};
    for (const r of roleRows) roleId[r.key] = r.id;
    for (const p of RBAC_PERMISSIONS) {
      const found: any[] = await q.query('SELECT `id` FROM `permission` WHERE `code` = ?', [p.code]);
      let pid: string;
      if (found.length === 0) {
        pid = randomUUID();
        await q.query(
          'INSERT INTO `permission` (`id`, `code`, `name`, `groupName`, `description`) VALUES (?, ?, ?, ?, ?)',
          [pid, p.code, p.name, p.groupName, ''],
        );
      } else {
        pid = found[0].id;
      }
      for (const rk of p.roles) {
        const rid = roleId[rk];
        if (!rid) continue;
        const ex: any[] = await q.query('SELECT 1 FROM `role_permissions` WHERE `roleId` = ? AND `permissionId` = ? LIMIT 1', [rid, pid]);
        if (ex.length === 0) await q.query('INSERT INTO `role_permissions` (`roleId`, `permissionId`) VALUES (?, ?)', [rid, pid]);
      }
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    const perms: any[] = await q.query('SELECT id FROM `permission` WHERE code = ?', ['operaciones.salidas.editar']);
    for (const p of perms) {
      await q.query('DELETE FROM `role_permissions` WHERE `permissionId` = ?', [p.id]);
      await q.query('DELETE FROM `permission` WHERE `id` = ?', [p.id]);
    }
    const col: any[] = await q.query("SHOW COLUMNS FROM `route_closure` LIKE 'closureGroupId'");
    if (col.length > 0) {
      await q.query('DROP INDEX `IDX_route_closure_group` ON `route_closure`');
      await q.query('ALTER TABLE `route_closure` DROP COLUMN `closureGroupId`');
    }
    await q.query('DROP TABLE IF EXISTS `package_dispatch_change`');
  }
}

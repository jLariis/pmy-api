import { MigrationInterface, QueryRunner } from 'typeorm';
import { randomUUID } from 'crypto';
import { RBAC_PERMISSIONS } from '../../auth/rbac/permission-catalog';

/**
 * Compras v3: da de alta `mttoVehiculos.revisar` (sincroniza el catálogo completo, idempotente) y lo concede
 * por USUARIO a Gerardo Robles junto con `mttoVehiculos.catalogos` y `mttoVehiculos.ordenes` (revisa solicitudes,
 * cotiza, administra catálogos y ve las órdenes). Si no existe, solo avisa.
 */
export class SyncComprasPermissions1786000000079 implements MigrationInterface {
  name = 'SyncComprasPermissions1786000000079';

  public async up(q: QueryRunner): Promise<void> {
    const roleRows: any[] = await q.query('SELECT `id`, `key` FROM `role`');
    const roleId: Record<string, string> = Object.fromEntries(roleRows.map((r) => [r.key, r.id]));
    const permId: Record<string, string> = {};
    for (const p of RBAC_PERMISSIONS) {
      const found: any[] = await q.query('SELECT `id` FROM `permission` WHERE `code` = ?', [p.code]);
      const pid = found[0]?.id ?? randomUUID();
      if (!found.length) {
        await q.query('INSERT INTO `permission` (`id`, `code`, `name`, `groupName`, `description`) VALUES (?, ?, ?, ?, ?)', [pid, p.code, p.name, p.groupName, '']);
      }
      permId[p.code] = pid;
      for (const rk of p.roles) {
        if (!roleId[rk]) continue;
        const ex: any[] = await q.query('SELECT 1 FROM `role_permissions` WHERE `roleId` = ? AND `permissionId` = ? LIMIT 1', [roleId[rk], pid]);
        if (!ex.length) await q.query('INSERT INTO `role_permissions` (`roleId`, `permissionId`) VALUES (?, ?)', [roleId[rk], pid]);
      }
    }
    const users: any[] = await q.query(
      `SELECT id FROM \`user\` WHERE LOWER(email) = 'gerardorobles@paqueteriaymensajeriadelyaqui.com'
          OR (LOWER(name) LIKE '%gerardo%' AND LOWER(COALESCE(lastName, '')) LIKE '%robles%')
       ORDER BY active DESC LIMIT 1`,
    );
    if (!users.length) {
      console.warn('[079] No se encontró a Gerardo Robles; asigna "mttoVehiculos.revisar" desde Roles y Permisos.');
      return;
    }
    for (const code of ['mttoVehiculos.revisar', 'mttoVehiculos.catalogos', 'mttoVehiculos.ordenes', 'mttoVehiculos.solicitudes']) {
      await q.query("INSERT IGNORE INTO `user_permission` (`id`, `userId`, `permissionId`, `effect`) VALUES (?, ?, ?, 'allow')",
        [randomUUID(), users[0].id, permId[code]]);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    const perms: any[] = await q.query("SELECT id FROM `permission` WHERE code = 'mttoVehiculos.revisar'");
    for (const p of perms) {
      await q.query('DELETE FROM `user_permission` WHERE `permissionId` = ?', [p.id]);
      await q.query('DELETE FROM `role_permissions` WHERE `permissionId` = ?', [p.id]);
      await q.query('DELETE FROM `permission` WHERE `id` = ?', [p.id]);
    }
  }
}

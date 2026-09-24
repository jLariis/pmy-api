import { MigrationInterface, QueryRunner } from 'typeorm';
import { randomUUID } from 'crypto';
import { RBAC_PERMISSIONS } from '../../auth/rbac/permission-catalog';

/**
 * Permisos del módulo de Mantenimiento: sincroniza el catálogo (misma lógica idempotente de las
 * Sync*Permission previas) y concede por USUARIO `mttoVehiculos.autorizar` (+ `mttoVehiculos.ordenes`
 * para que pueda abrir las órdenes) a Edgardo Lugo. Se le busca por correo o por nombre+apellido
 * (su correo en BD tiene un typo: "mensajeridelyaqui"). Si no existe, solo avisa: se asigna luego
 * desde Configuración → Roles y Permisos.
 */
export class SyncMaintenancePermissions1786000000075 implements MigrationInterface {
  name = 'SyncMaintenancePermissions1786000000075';

  private static readonly NEW_CODES = [
    'mttoVehiculos.solicitudes', 'mttoVehiculos.ordenes', 'mttoVehiculos.catalogos', 'mttoVehiculos.autorizar',
  ];

  public async up(q: QueryRunner): Promise<void> {
    const roleRows: any[] = await q.query('SELECT `id`, `key` FROM `role`');
    const roleId: Record<string, string> = {};
    for (const r of roleRows) roleId[r.key] = r.id;

    const permId: Record<string, string> = {};
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
      permId[p.code] = pid;
      for (const rk of p.roles) {
        const rid = roleId[rk];
        if (!rid) continue;
        const ex: any[] = await q.query('SELECT 1 FROM `role_permissions` WHERE `roleId` = ? AND `permissionId` = ? LIMIT 1', [rid, pid]);
        if (ex.length === 0) {
          await q.query('INSERT INTO `role_permissions` (`roleId`, `permissionId`) VALUES (?, ?)', [rid, pid]);
        }
      }
    }

    const users: any[] = await q.query(
      `SELECT id FROM \`user\`
       WHERE LOWER(email) IN ('edgardolugo@paqueteriaymensajeriadelyaqui.com', 'edgardolugo@paqueteriaymensajeridelyaqui.com')
          OR (LOWER(name) LIKE '%edgardo%' AND LOWER(COALESCE(lastName, '')) LIKE '%lugo%')
       ORDER BY active DESC
       LIMIT 1`,
    );
    if (users.length === 0) {
      console.warn('[075] No se encontró a Edgardo Lugo; asigna "mttoVehiculos.autorizar" desde Roles y Permisos.');
      return;
    }
    for (const code of ['mttoVehiculos.autorizar', 'mttoVehiculos.ordenes']) {
      await q.query(
        "INSERT IGNORE INTO `user_permission` (`id`, `userId`, `permissionId`, `effect`) VALUES (?, ?, ?, 'allow')",
        [randomUUID(), users[0].id, permId[code]],
      );
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    const codes = SyncMaintenancePermissions1786000000075.NEW_CODES;
    const ph = codes.map(() => '?').join(',');
    const perms: any[] = await q.query(`SELECT id FROM \`permission\` WHERE code IN (${ph})`, codes);
    for (const p of perms) {
      await q.query('DELETE FROM `user_permission` WHERE `permissionId` = ?', [p.id]);
      await q.query('DELETE FROM `role_permissions` WHERE `permissionId` = ?', [p.id]);
      await q.query('DELETE FROM `permission` WHERE `id` = ?', [p.id]);
    }
  }
}

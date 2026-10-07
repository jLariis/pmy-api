import { MigrationInterface, QueryRunner } from 'typeorm';
import { randomUUID } from 'crypto';
import { RBAC_PERMISSIONS } from '../../auth/rbac/permission-catalog';

/**
 * Bandeja de correos con menú y grupo de permisos propio ("Correos"):
 *   correo.bandeja    → ver bandeja y seguimiento (ya existía; cambia nombre y grupo)
 *   correo.subir      → confirmar sucursal, ignorar y subir guías al pegado
 *   correo.configurar → buzón, cobertura de CP, alertas y WhatsApp (antes fijo a superadmin)
 * Idempotente: inserta lo que falte y alinea nombre/grupo con el catálogo.
 */
const CODES = ['correo.bandeja', 'correo.subir', 'correo.configurar'];

export class CorreosPermissions1786000000096 implements MigrationInterface {
  name = 'CorreosPermissions1786000000096';

  public async up(q: QueryRunner): Promise<void> {
    const roleRows: any[] = await q.query('SELECT `id`, `key` FROM `role`');
    const roleId: Record<string, string> = {};
    for (const r of roleRows) roleId[r.key] = r.id;

    for (const p of RBAC_PERMISSIONS.filter((x) => CODES.includes(x.code))) {
      const found: any[] = await q.query('SELECT `id` FROM `permission` WHERE `code` = ?', [p.code]);
      let pid: string;
      if (found.length === 0) {
        pid = randomUUID();
        await q.query('INSERT INTO `permission` (`id`, `code`, `name`, `groupName`, `description`) VALUES (?, ?, ?, ?, ?)', [pid, p.code, p.name, p.groupName, '']);
      } else {
        pid = found[0].id;
        await q.query('UPDATE `permission` SET `name` = ?, `groupName` = ? WHERE `id` = ?', [p.name, p.groupName, pid]);
      }
      for (const rk of p.roles) {
        const rid = roleId[rk];
        if (!rid) continue;
        const ex: any[] = await q.query('SELECT 1 FROM `role_permissions` WHERE `roleId` = ? AND `permissionId` = ? LIMIT 1', [rid, pid]);
        if (ex.length === 0) await q.query('INSERT INTO `role_permissions` (`roleId`, `permissionId`) VALUES (?, ?)', [rid, pid]);
      }
    }
    // Quien ya veía la bandeja por usuario puede seguir usándola igual que antes (confirmar y subir).
    const [subir]: any[] = await q.query("SELECT `id` FROM `permission` WHERE `code` = 'correo.subir'");
    const holders: any[] = await q.query(
      "SELECT up.`userId` FROM `user_permission` up JOIN `permission` p ON p.`id` = up.`permissionId` WHERE p.`code` = 'correo.bandeja' AND up.`effect` = 'allow'",
    );
    for (const h of holders) {
      const ex: any[] = await q.query('SELECT 1 FROM `user_permission` WHERE `userId` = ? AND `permissionId` = ? LIMIT 1', [h.userId, subir.id]);
      if (ex.length === 0) await q.query("INSERT INTO `user_permission` (`id`, `userId`, `permissionId`, `effect`) VALUES (?, ?, ?, 'allow')", [randomUUID(), h.userId, subir.id]);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const code of ['correo.subir', 'correo.configurar']) {
      const perms: any[] = await q.query('SELECT `id` FROM `permission` WHERE `code` = ?', [code]);
      for (const p of perms) {
        await q.query('DELETE FROM `user_permission` WHERE `permissionId` = ?', [p.id]);
        await q.query('DELETE FROM `role_permissions` WHERE `permissionId` = ?', [p.id]);
        await q.query('DELETE FROM `permission` WHERE `id` = ?', [p.id]);
      }
    }
    await q.query("UPDATE `permission` SET `name` = 'Bandeja de correos', `groupName` = 'Operaciones' WHERE `code` = 'correo.bandeja'");
  }
}

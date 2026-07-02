import { MigrationInterface, QueryRunner } from 'typeorm';
import { randomUUID } from 'crypto';
import { RBAC_PERMISSIONS } from '../../auth/rbac/permission-catalog';

/**
 * Sincroniza el catálogo de permisos contra la BD para dar de alta los reportes
 * nuevos `reportes.rutas` y `reportes.bodega` (LD) y asignarlos a sus roles por
 * defecto. Reusa la misma lógica idempotente de SyncReportPermissions: solo
 * inserta lo que falta, así que es seguro re-ejecutar.
 */
export class SyncNewReportPermissions1786000000023 implements MigrationInterface {
  name = 'SyncNewReportPermissions1786000000023';

  public async up(q: QueryRunner): Promise<void> {
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
        if (ex.length === 0) {
          await q.query('INSERT INTO `role_permissions` (`roleId`, `permissionId`) VALUES (?, ?)', [rid, pid]);
        }
      }
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    const codes = ['reportes.rutas', 'reportes.bodega'];
    const ph = codes.map(() => '?').join(',');
    const perms: any[] = await q.query(`SELECT id FROM \`permission\` WHERE code IN (${ph})`, codes);
    for (const p of perms) {
      await q.query('DELETE FROM `role_permissions` WHERE `permissionId` = ?', [p.id]);
      await q.query('DELETE FROM `permission` WHERE `id` = ?', [p.id]);
    }
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';
import { randomUUID } from 'crypto';
import { RBAC_PERMISSIONS } from '../../auth/rbac/permission-catalog';

/**
 * Re-sincroniza el catálogo de permisos (incluye los nuevos `reportes.*` por
 * reporte) contra la BD: inserta los que falten y los asigna a sus roles por
 * defecto. Idempotente (reusa la misma lógica que SyncRbacPermissions).
 */
export class SyncReportPermissions1786000000015 implements MigrationInterface {
  name = 'SyncReportPermissions1786000000015';

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
    const codes = RBAC_PERMISSIONS.filter((p) => p.code.startsWith('reportes.')).map((p) => p.code);
    if (codes.length === 0) return;
    const ph = codes.map(() => '?').join(',');
    const perms: any[] = await q.query(`SELECT id FROM \`permission\` WHERE code IN (${ph})`, codes);
    for (const p of perms) {
      await q.query('DELETE FROM `role_permissions` WHERE `permissionId` = ?', [p.id]);
      await q.query('DELETE FROM `permission` WHERE `id` = ?', [p.id]);
    }
  }
}

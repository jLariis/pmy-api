import { MigrationInterface, QueryRunner } from 'typeorm';
import { randomUUID } from 'crypto';
import { RBAC_PERMISSIONS } from '../../auth/rbac/permission-catalog';

/**
 * Historial de envíos del menú Correos (WhatsApp, campana y correo de alertas, aviso de subida y
 * avisos a mano) + permiso "Mandar avisos" (correo.avisar, solo superadmin por defecto).
 */
export class CorreoSendLog1786000000100 implements MigrationInterface {
  name = 'CorreoSendLog1786000000100';

  public async up(q: QueryRunner): Promise<void> {
    if (!(await q.hasTable('correo_send_log'))) {
      await q.query(`CREATE TABLE \`correo_send_log\` (
        \`id\` varchar(36) NOT NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`channel\` varchar(12) NOT NULL,
        \`origin\` varchar(12) NOT NULL,
        \`recipientType\` varchar(12) NOT NULL,
        \`recipientId\` varchar(120) NOT NULL,
        \`recipientName\` varchar(255) NULL,
        \`sentById\` varchar(36) NULL,
        \`sentByName\` varchar(255) NULL,
        \`subsidiaryId\` varchar(36) NULL,
        \`consNumber\` varchar(40) NULL,
        \`inboxMessageId\` varchar(36) NULL,
        \`title\` varchar(255) NULL,
        \`body\` text NOT NULL,
        \`status\` varchar(12) NOT NULL,
        \`error\` varchar(500) NULL,
        INDEX \`IDX_correo_send_log_created\` (\`createdAt\`),
        INDEX \`IDX_correo_send_log_cons\` (\`consNumber\`),
        INDEX \`IDX_correo_send_log_sub\` (\`subsidiaryId\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB`);
    }

    const roleRows: any[] = await q.query('SELECT `id`, `key` FROM `role`');
    const roleId: Record<string, string> = {};
    for (const r of roleRows) roleId[r.key] = r.id;
    for (const p of RBAC_PERMISSIONS.filter((x) => x.code === 'correo.avisar')) {
      const found: any[] = await q.query('SELECT `id` FROM `permission` WHERE `code` = ?', [p.code]);
      const pid = found[0]?.id ?? randomUUID();
      if (!found.length) {
        await q.query('INSERT INTO `permission` (`id`, `code`, `name`, `groupName`, `description`) VALUES (?, ?, ?, ?, ?)', [pid, p.code, p.name, p.groupName, '']);
      }
      for (const rk of p.roles) {
        const rid = roleId[rk];
        if (!rid) continue;
        const ex: any[] = await q.query('SELECT 1 FROM `role_permissions` WHERE `roleId` = ? AND `permissionId` = ? LIMIT 1', [rid, pid]);
        if (!ex.length) await q.query('INSERT INTO `role_permissions` (`roleId`, `permissionId`) VALUES (?, ?)', [rid, pid]);
      }
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    const perms: any[] = await q.query("SELECT id FROM `permission` WHERE code = 'correo.avisar'");
    for (const p of perms) {
      await q.query('DELETE FROM `user_permission` WHERE `permissionId` = ?', [p.id]);
      await q.query('DELETE FROM `role_permissions` WHERE `permissionId` = ?', [p.id]);
      await q.query('DELETE FROM `permission` WHERE `id` = ?', [p.id]);
    }
    if (await q.hasTable('correo_send_log')) await q.query('DROP TABLE `correo_send_log`');
  }
}

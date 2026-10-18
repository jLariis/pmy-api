import { MigrationInterface, QueryRunner } from 'typeorm';
import { randomUUID } from 'crypto';
import { RBAC_PERMISSIONS } from '../../auth/rbac/permission-catalog';

/**
 * Tareas del día (2026-10-17): checklist automático por consolidado y por sucursal.
 *  - `daily_task`: estado de cada paso por (sucursal, día, referencia, paso).
 *  - `daily_ld`: foto de los LD de cada día (cron 20:30).
 *  - `ops_alert`: `consolidatedId` / `chargeId` y `step` más largo (pasos nuevos).
 *  - `ops_alert_subsidiary`: pasos nuevos y horarios por sucursal, con una fila por sucursal
 *    activa llena con los predefinidos acordados.
 *  - `daily_task.notifiedStatus` (último estado avisado) y `daily_ld.pieceKey` (pieza DHL).
 *  - Índices en `devolution(shipmentId)` / `(chargeShipmentId)` (el cron los consulta cada 5 min).
 *  - Permiso `operaciones.tareas`.
 * DEFENSIVA: guards a information_schema; correrla dos veces no falla.
 */
const SCHEDULE_DEFAULTS: [string, string, string | number][] = [
  ['uploadMinutes', 'int NULL', 30],
  ['unloadingTime', 'varchar(5) NULL', '21:00'],
  ['dispatchAfterUnloadMinutes', 'int NULL', 120],
  ['dispatchNextDayTime', 'varchar(5) NULL', '10:00'],
  ['closureTime', 'varchar(5) NULL', '21:00'],
  ['inventoryInitialTime', 'varchar(5) NULL', '10:00'],
  ['devolutionsTime', 'varchar(5) NULL', '19:30'],
  ['inventoryFinalTime', 'varchar(5) NULL', '20:00'],
];

export class DailyTasks1786000000109 implements MigrationInterface {
  name = 'DailyTasks1786000000109';

  private async has(q: QueryRunner, table: string, column?: string): Promise<boolean> {
    const rows = column
      ? await q.query('SELECT COUNT(*) c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [table, column])
      : await q.query('SELECT COUNT(*) c FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [table]);
    return Number(rows[0].c) > 0;
  }

  private async hasIndex(q: QueryRunner, table: string, index: string): Promise<boolean> {
    const rows = await q.query('SELECT COUNT(*) c FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?', [table, index]);
    return Number(rows[0].c) > 0;
  }

  public async up(q: QueryRunner): Promise<void> {
    if (!(await this.has(q, 'daily_task'))) {
      await q.query(`CREATE TABLE \`daily_task\` (
        \`id\` varchar(36) NOT NULL,
        \`subsidiaryId\` varchar(36) NOT NULL,
        \`day\` date NOT NULL,
        \`refType\` varchar(12) NOT NULL,
        \`refId\` varchar(36) NOT NULL,
        \`consNumber\` varchar(40) NULL,
        \`step\` varchar(20) NOT NULL,
        \`status\` varchar(10) NOT NULL,
        \`notifiedStatus\` varchar(10) NULL,
        \`doneCount\` int NOT NULL DEFAULT 0,
        \`totalCount\` int NOT NULL DEFAULT 0,
        \`dueAt\` datetime NOT NULL,
        \`doneAt\` datetime NULL,
        \`doneById\` varchar(36) NULL,
        \`doneByName\` varchar(160) NULL,
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`UQ_daily_task\` (\`subsidiaryId\`, \`day\`, \`refType\`, \`refId\`, \`step\`),
        KEY \`IDX_daily_task_sub_day\` (\`subsidiaryId\`, \`day\`)
      ) ENGINE=InnoDB`);
    }
    if (!(await this.has(q, 'daily_ld'))) {
      await q.query(`CREATE TABLE \`daily_ld\` (
        \`id\` varchar(36) NOT NULL,
        \`subsidiaryId\` varchar(36) NOT NULL,
        \`day\` date NOT NULL,
        \`trackingNumber\` varchar(64) NOT NULL,
        \`pieceKey\` varchar(64) NOT NULL,
        \`shipmentId\` varchar(36) NULL,
        \`chargeShipmentId\` varchar(36) NULL,
        \`consNumber\` varchar(40) NULL,
        \`status\` varchar(40) NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`UQ_daily_ld\` (\`subsidiaryId\`, \`day\`, \`pieceKey\`)
      ) ENGINE=InnoDB`);
    }

    // Bases donde ya corrió una versión previa de esta migración (desarrollo).
    if (!(await this.has(q, 'daily_task', 'notifiedStatus'))) await q.query('ALTER TABLE `daily_task` ADD COLUMN `notifiedStatus` varchar(10) NULL AFTER `status`');
    if (!(await this.has(q, 'daily_ld', 'pieceKey'))) {
      await q.query('ALTER TABLE `daily_ld` ADD COLUMN `pieceKey` varchar(64) NULL AFTER `trackingNumber`');
      await q.query('UPDATE `daily_ld` SET `pieceKey` = `trackingNumber` WHERE `pieceKey` IS NULL');
      await q.query('ALTER TABLE `daily_ld` MODIFY `pieceKey` varchar(64) NOT NULL, DROP INDEX `UQ_daily_ld`, ADD UNIQUE KEY `UQ_daily_ld` (`subsidiaryId`, `day`, `pieceKey`)');
    }
    for (const [name, col] of [['IDX_devolution_shipmentId', 'shipmentId'], ['IDX_devolution_chargeShipmentId', 'chargeShipmentId']]) {
      if (!(await this.hasIndex(q, 'devolution', name))) await q.query(`CREATE INDEX \`${name}\` ON \`devolution\` (\`${col}\`)`);
    }

    for (const col of ['consolidatedId', 'chargeId']) {
      if (!(await this.has(q, 'ops_alert', col))) await q.query(`ALTER TABLE \`ops_alert\` ADD COLUMN \`${col}\` varchar(36) NULL DEFAULT NULL`);
    }
    await q.query('ALTER TABLE `ops_alert` MODIFY `step` varchar(20) NOT NULL');

    for (const col of ['stepDevolutions', 'stepInventoryInitial']) {
      if (!(await this.has(q, 'ops_alert_subsidiary', col))) await q.query(`ALTER TABLE \`ops_alert_subsidiary\` ADD COLUMN \`${col}\` tinyint NOT NULL DEFAULT 1`);
    }
    for (const [col, type] of SCHEDULE_DEFAULTS) {
      if (!(await this.has(q, 'ops_alert_subsidiary', col))) await q.query(`ALTER TABLE \`ops_alert_subsidiary\` ADD COLUMN \`${col}\` ${type} DEFAULT NULL`);
    }
    // Una fila por sucursal activa; los horarios vacíos se llenan con los predefinidos.
    await q.query('INSERT INTO `ops_alert_subsidiary` (`subsidiaryId`) SELECT s.`id` FROM `subsidiary` s LEFT JOIN `ops_alert_subsidiary` o ON o.`subsidiaryId` = s.`id` WHERE s.`active` = 1 AND o.`subsidiaryId` IS NULL');
    for (const [col, , value] of SCHEDULE_DEFAULTS) {
      await q.query(`UPDATE \`ops_alert_subsidiary\` SET \`${col}\` = ? WHERE \`${col}\` IS NULL`, [value]);
    }

    await this.seedPermission(q);
  }

  private async seedPermission(q: QueryRunner): Promise<void> {
    const p = RBAC_PERMISSIONS.find((x) => x.code === 'operaciones.tareas');
    if (!p) return;
    const roleRows: any[] = await q.query('SELECT `id`, `key` FROM `role`');
    const roleId: Record<string, string> = {};
    for (const r of roleRows) roleId[r.key] = r.id;
    const found: any[] = await q.query('SELECT `id` FROM `permission` WHERE `code` = ?', [p.code]);
    const pid = found[0]?.id ?? randomUUID();
    if (!found.length) await q.query('INSERT INTO `permission` (`id`, `code`, `name`, `groupName`, `description`) VALUES (?, ?, ?, ?, ?)', [pid, p.code, p.name, p.groupName, '']);
    for (const rk of p.roles) {
      const rid = roleId[rk];
      if (!rid) continue;
      const ex: any[] = await q.query('SELECT 1 FROM `role_permissions` WHERE `roleId` = ? AND `permissionId` = ? LIMIT 1', [rid, pid]);
      if (!ex.length) await q.query('INSERT INTO `role_permissions` (`roleId`, `permissionId`) VALUES (?, ?)', [rid, pid]);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    const perms: any[] = await q.query("SELECT `id` FROM `permission` WHERE `code` = 'operaciones.tareas'");
    for (const p of perms) {
      await q.query('DELETE FROM `user_permission` WHERE `permissionId` = ?', [p.id]);
      await q.query('DELETE FROM `role_permissions` WHERE `permissionId` = ?', [p.id]);
      await q.query('DELETE FROM `permission` WHERE `id` = ?', [p.id]);
    }
    for (const [col] of SCHEDULE_DEFAULTS) {
      if (await this.has(q, 'ops_alert_subsidiary', col)) await q.query(`ALTER TABLE \`ops_alert_subsidiary\` DROP COLUMN \`${col}\``);
    }
    for (const col of ['stepDevolutions', 'stepInventoryInitial']) {
      if (await this.has(q, 'ops_alert_subsidiary', col)) await q.query(`ALTER TABLE \`ops_alert_subsidiary\` DROP COLUMN \`${col}\``);
    }
    for (const col of ['consolidatedId', 'chargeId']) {
      if (await this.has(q, 'ops_alert', col)) await q.query(`ALTER TABLE \`ops_alert\` DROP COLUMN \`${col}\``);
    }
    for (const name of ['IDX_devolution_shipmentId', 'IDX_devolution_chargeShipmentId']) {
      if (await this.hasIndex(q, 'devolution', name)) await q.query(`DROP INDEX \`${name}\` ON \`devolution\``);
    }
    await q.query('DROP TABLE IF EXISTS `daily_ld`');
    await q.query('DROP TABLE IF EXISTS `daily_task`');
  }
}

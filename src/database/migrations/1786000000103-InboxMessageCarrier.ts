import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bandeja de correos separada por paquetería (FedEx / DHL). `carrier` se decide al leer el
 * correo: dominio del remitente o, en un reenvío, el del remitente original (DHL manda a
 * hotmail y de ahí se reenvía a sistemas@). Los correos que ya existen se marcan DHL si el
 * remitente es de un dominio DHL; los reenvíos viejos se reprocesan con
 * scripts/inbox-rescan-dhl.ts (estaban ignorados y sin cuerpo guardado).
 *
 * `textBody` = cuerpo completo en texto plano (con el historial del reenvío). En DHL es lo que
 * se pega en "Importar DHL" (bloques "AWB :"), y el lector necesita los espacios originales.
 */
export class InboxMessageCarrier1786000000103 implements MigrationInterface {
  name = 'InboxMessageCarrier1786000000103';

  public async up(q: QueryRunner): Promise<void> {
    if (!(await q.hasColumn('inbox_message', 'carrier'))) {
      await q.query("ALTER TABLE `inbox_message` ADD `carrier` varchar(10) NOT NULL DEFAULT 'fedex'");
      await q.query('CREATE INDEX `IDX_inbox_message_carrier` ON `inbox_message` (`carrier`)');
    }
    if (!(await q.hasColumn('inbox_message', 'textBody'))) {
      await q.query('ALTER TABLE `inbox_message` ADD `textBody` mediumtext NULL');
    }
    await q.query("UPDATE `inbox_message` SET `carrier` = 'dhl' WHERE `fromAddress` LIKE '%@dhl.com' OR `fromAddress` LIKE '%.dhl.com'");
  }

  public async down(q: QueryRunner): Promise<void> {
    if (await q.hasColumn('inbox_message', 'textBody')) await q.query('ALTER TABLE `inbox_message` DROP COLUMN `textBody`');
    if (await q.hasColumn('inbox_message', 'carrier')) {
      await q.query('DROP INDEX `IDX_inbox_message_carrier` ON `inbox_message`');
      await q.query('ALTER TABLE `inbox_message` DROP COLUMN `carrier`');
    }
  }
}

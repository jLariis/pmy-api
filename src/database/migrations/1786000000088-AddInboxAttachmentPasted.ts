import { MigrationInterface, QueryRunner } from 'typeorm';

/** Bandeja de correos: registra cuándo/quién mandó un adjunto al "Pegar FedEx". */
export class AddInboxAttachmentPasted1786000000088 implements MigrationInterface {
  name = 'AddInboxAttachmentPasted1786000000088';

  public async up(q: QueryRunner): Promise<void> {
    if (!(await q.hasColumn('inbox_attachment', 'pastedAt'))) {
      await q.query('ALTER TABLE `inbox_attachment` ADD `pastedAt` datetime NULL, ADD `pastedById` varchar(36) NULL');
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    if (await q.hasColumn('inbox_attachment', 'pastedAt')) {
      await q.query('ALTER TABLE `inbox_attachment` DROP COLUMN `pastedAt`, DROP COLUMN `pastedById`');
    }
  }
}

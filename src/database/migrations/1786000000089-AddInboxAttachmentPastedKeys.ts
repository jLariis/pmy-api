import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bandeja de correos: un libro puede traer varias hojas (YAQUI / F2 / HV) y cada una se
 * sube por separado; `pastedKeys` guarda qué bloques de ese archivo ya se subieron.
 */
export class AddInboxAttachmentPastedKeys1786000000089 implements MigrationInterface {
  name = 'AddInboxAttachmentPastedKeys1786000000089';

  public async up(q: QueryRunner): Promise<void> {
    if (!(await q.hasColumn('inbox_attachment', 'pastedKeys'))) {
      await q.query('ALTER TABLE `inbox_attachment` ADD `pastedKeys` json NULL');
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    if (await q.hasColumn('inbox_attachment', 'pastedKeys')) await q.query('ALTER TABLE `inbox_attachment` DROP COLUMN `pastedKeys`');
  }
}

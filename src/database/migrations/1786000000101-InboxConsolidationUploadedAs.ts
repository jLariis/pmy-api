import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Consolidado anunciado en el correo que se subió con OTRO número (p. ej. la F2 sin número que se
 * subió con el número del master): `uploadedAs` guarda el número real para que Seguimiento, alertas
 * y avisos revisen las guías correctas y no lo marquen como "no se ha subido". `uploadedAsKind` dice si
 * quedó como paquete ('master') o como carga ('f2'): una F2 subida como paquete = tipo equivocado.
 */
export class InboxConsolidationUploadedAs1786000000101 implements MigrationInterface {
  name = 'InboxConsolidationUploadedAs1786000000101';

  public async up(q: QueryRunner): Promise<void> {
    if (!(await q.hasColumn('inbox_consolidation', 'uploadedAs'))) {
      await q.query('ALTER TABLE `inbox_consolidation` ADD `uploadedAs` varchar(40) NULL, ADD `uploadedAsKind` varchar(10) NULL');
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    if (await q.hasColumn('inbox_consolidation', 'uploadedAs')) await q.query('ALTER TABLE `inbox_consolidation` DROP COLUMN `uploadedAs`, DROP COLUMN `uploadedAsKind`');
  }
}

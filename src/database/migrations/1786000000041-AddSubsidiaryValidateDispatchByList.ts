import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Flag por sucursal: modo de validación de paquetes en salidas a ruta.
 * Si está activo, el escaneo se valida por lista en un solo request (endpoint
 * batch) y el backend devuelve los paquetes ya ordenados; si no, se conserva el
 * comportamiento histórico de validación uno-por-uno.
 */
export class AddSubsidiaryValidateDispatchByList1786000000041 implements MigrationInterface {
  name = 'AddSubsidiaryValidateDispatchByList1786000000041';

  public async up(q: QueryRunner): Promise<void> {
    const exists: any[] = await q.query("SHOW COLUMNS FROM `subsidiary` LIKE 'validateDispatchByList'");
    if (exists.length === 0) {
      await q.query('ALTER TABLE `subsidiary` ADD COLUMN `validateDispatchByList` TINYINT(1) NOT NULL DEFAULT 0');
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    const exists: any[] = await q.query("SHOW COLUMNS FROM `subsidiary` LIKE 'validateDispatchByList'");
    if (exists.length > 0) {
      await q.query('ALTER TABLE `subsidiary` DROP COLUMN `validateDispatchByList`');
    }
  }
}

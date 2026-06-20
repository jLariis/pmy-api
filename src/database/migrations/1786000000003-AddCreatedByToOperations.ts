import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Agrega `createdById` (autor del registro) a las tablas de operaciones que no lo
 * tenían: devolution, collection, income, shipment, charge_shipment. Permite saber
 * QUIÉN creó cada registro de aquí en adelante (auditoría / detalle por sucursal).
 */
export class AddCreatedByToOperations1786000000003 implements MigrationInterface {
  name = 'AddCreatedByToOperations1786000000003'

  private readonly tables = ['devolution', 'collection', 'income', 'shipment', 'charge_shipment'];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of this.tables) {
      const cols: any[] = await queryRunner.query(
        `SHOW COLUMNS FROM \`${table}\` LIKE 'createdById'`,
      );
      if (cols.length === 0) {
        await queryRunner.query(
          `ALTER TABLE \`${table}\` ADD COLUMN \`createdById\` varchar(36) NULL`,
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of this.tables) {
      const cols: any[] = await queryRunner.query(
        `SHOW COLUMNS FROM \`${table}\` LIKE 'createdById'`,
      );
      if (cols.length > 0) {
        await queryRunner.query(`ALTER TABLE \`${table}\` DROP COLUMN \`createdById\``);
      }
    }
  }
}

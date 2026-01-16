import { MigrationInterface, QueryRunner } from "typeorm";

export class RenameInvetoryToInventory1768538084873 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.renameTable('invetory', 'inventory');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.renameTable('inventory', 'invetory');
  }
}

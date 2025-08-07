import { MigrationInterface, QueryRunner } from "typeorm";

export class AddUnloadingToShipment1754434798048 implements MigrationInterface {
    name = 'AddUnloadingToShipment1754434798048'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`shipment\` ADD \`unloadingId\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`charge_shipment\` ADD \`unloadingId\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`shipment\` ADD CONSTRAINT \`FK_d761e138cc8d738698841f28fd4\` FOREIGN KEY (\`unloadingId\`) REFERENCES \`unloading\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`charge_shipment\` ADD CONSTRAINT \`FK_daabc3d527d570efbcd33465a4e\` FOREIGN KEY (\`unloadingId\`) REFERENCES \`unloading\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`charge_shipment\` DROP FOREIGN KEY \`FK_daabc3d527d570efbcd33465a4e\``);
        await queryRunner.query(`ALTER TABLE \`shipment\` DROP FOREIGN KEY \`FK_d761e138cc8d738698841f28fd4\``);
        await queryRunner.query(`ALTER TABLE \`charge_shipment\` DROP COLUMN \`unloadingId\``);
        await queryRunner.query(`ALTER TABLE \`shipment\` DROP COLUMN \`unloadingId\``);
    }

}

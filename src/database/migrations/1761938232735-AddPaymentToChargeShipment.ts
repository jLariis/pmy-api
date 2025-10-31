import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPaymentToChargeShipment1761938232735 implements MigrationInterface {
    name = 'AddPaymentToChargeShipment1761938232735'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`payment\` ADD \`chargeShipmentId\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`payment\` ADD UNIQUE INDEX \`IDX_7e498b2ca992b1640cb27fcbfb\` (\`chargeShipmentId\`)`);
        await queryRunner.query(`CREATE UNIQUE INDEX \`REL_7e498b2ca992b1640cb27fcbfb\` ON \`payment\` (\`chargeShipmentId\`)`);
        await queryRunner.query(`ALTER TABLE \`payment\` ADD CONSTRAINT \`FK_7e498b2ca992b1640cb27fcbfbc\` FOREIGN KEY (\`chargeShipmentId\`) REFERENCES \`charge_shipment\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`payment\` DROP FOREIGN KEY \`FK_7e498b2ca992b1640cb27fcbfbc\``);
        await queryRunner.query(`DROP INDEX \`REL_7e498b2ca992b1640cb27fcbfb\` ON \`payment\``);
        await queryRunner.query(`ALTER TABLE \`payment\` DROP INDEX \`IDX_7e498b2ca992b1640cb27fcbfb\``);
        await queryRunner.query(`ALTER TABLE \`payment\` DROP COLUMN \`chargeShipmentId\``);
    }

}

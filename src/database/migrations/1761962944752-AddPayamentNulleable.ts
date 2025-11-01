import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPayamentNulleable1761962944752 implements MigrationInterface {
    name = 'AddPayamentNulleable1761962944752'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`payment\` DROP FOREIGN KEY \`FK_61825ea78b27d5b3c19336ca7da\``);
        await queryRunner.query(`ALTER TABLE \`payment\` DROP FOREIGN KEY \`FK_7e498b2ca992b1640cb27fcbfbc\``);
        await queryRunner.query(`DROP INDEX \`IDX_7e498b2ca992b1640cb27fcbfb\` ON \`payment\``);
        await queryRunner.query(`CREATE INDEX \`IDX_7e498b2ca992b1640cb27fcbfb\` ON \`payment\` (\`chargeShipmentId\`)`);
        await queryRunner.query(`ALTER TABLE \`payment\` ADD CONSTRAINT \`FK_61825ea78b27d5b3c19336ca7da\` FOREIGN KEY (\`shipmentId\`) REFERENCES \`shipment\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`payment\` ADD CONSTRAINT \`FK_7e498b2ca992b1640cb27fcbfbc\` FOREIGN KEY (\`chargeShipmentId\`) REFERENCES \`charge_shipment\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`payment\` DROP FOREIGN KEY \`FK_7e498b2ca992b1640cb27fcbfbc\``);
        await queryRunner.query(`ALTER TABLE \`payment\` DROP FOREIGN KEY \`FK_61825ea78b27d5b3c19336ca7da\``);
        await queryRunner.query(`DROP INDEX \`IDX_7e498b2ca992b1640cb27fcbfb\` ON \`payment\``);
        await queryRunner.query(`CREATE UNIQUE INDEX \`IDX_7e498b2ca992b1640cb27fcbfb\` ON \`payment\` (\`chargeShipmentId\`)`);
        await queryRunner.query(`ALTER TABLE \`payment\` ADD CONSTRAINT \`FK_7e498b2ca992b1640cb27fcbfbc\` FOREIGN KEY (\`chargeShipmentId\`) REFERENCES \`charge_shipment\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`payment\` ADD CONSTRAINT \`FK_61825ea78b27d5b3c19336ca7da\` FOREIGN KEY (\`shipmentId\`) REFERENCES \`shipment\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

}

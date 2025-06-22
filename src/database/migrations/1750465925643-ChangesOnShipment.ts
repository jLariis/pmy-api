import { MigrationInterface, QueryRunner } from "typeorm";

export class ChangesOnShipment1750465925643 implements MigrationInterface {
    name = 'ChangesOnShipment1750465925643'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`shipment_status\` DROP FOREIGN KEY \`FK_dbcc468aa22a0f853dd0851197e\``);
        await queryRunner.query(`ALTER TABLE \`shipment_status\` ADD CONSTRAINT \`FK_dbcc468aa22a0f853dd0851197e\` FOREIGN KEY (\`shipmentId\`) REFERENCES \`shipment\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`shipment_status\` DROP FOREIGN KEY \`FK_dbcc468aa22a0f853dd0851197e\``);
        await queryRunner.query(`ALTER TABLE \`shipment_status\` ADD CONSTRAINT \`FK_dbcc468aa22a0f853dd0851197e\` FOREIGN KEY (\`shipmentId\`) REFERENCES \`shipment\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

}

import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPackageDispatchHistory1773698864041 implements MigrationInterface {
    name = 'AddPackageDispatchHistory1773698864041'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`package_dispatch_history\` (\`id\` varchar(36) NOT NULL, \`addedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, \`dispatchId\` varchar(36) NULL, \`shipmentId\` varchar(36) NULL, \`chargeShipmentId\` varchar(36) NULL, PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`package_dispatch\` ADD \`createdBy\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`package_dispatch_history\` ADD CONSTRAINT \`FK_919fc50a30e69553cd7dbcd50ee\` FOREIGN KEY (\`dispatchId\`) REFERENCES \`package_dispatch\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`package_dispatch_history\` ADD CONSTRAINT \`FK_70a6bc18457de52867be38f8647\` FOREIGN KEY (\`shipmentId\`) REFERENCES \`shipment\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`package_dispatch_history\` ADD CONSTRAINT \`FK_86895c96bd1ebb226746892a549\` FOREIGN KEY (\`chargeShipmentId\`) REFERENCES \`charge_shipment\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`package_dispatch_history\` DROP FOREIGN KEY \`FK_86895c96bd1ebb226746892a549\``);
        await queryRunner.query(`ALTER TABLE \`package_dispatch_history\` DROP FOREIGN KEY \`FK_70a6bc18457de52867be38f8647\``);
        await queryRunner.query(`ALTER TABLE \`package_dispatch_history\` DROP FOREIGN KEY \`FK_919fc50a30e69553cd7dbcd50ee\``);
        await queryRunner.query(`ALTER TABLE \`package_dispatch\` DROP COLUMN \`createdBy\``);
        await queryRunner.query(`DROP TABLE \`package_dispatch_history\``);
    }

}

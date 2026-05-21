import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDispatchIdToShipmentsNotInFile1779299174609 implements MigrationInterface {
    name = 'AddDispatchIdToShipmentsNotInFile1779299174609'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`shipment_not_in_files\` DROP FOREIGN KEY \`FK_shipment_not_in_files_subsidiary\``);
        await queryRunner.query(`ALTER TABLE \`shipment_not_in_files\` ADD \`dispatchId\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`shipment_not_in_files\` DROP PRIMARY KEY`);
        await queryRunner.query(`ALTER TABLE \`shipment_not_in_files\` DROP COLUMN \`id\``);
        await queryRunner.query(`ALTER TABLE \`shipment_not_in_files\` ADD \`id\` varchar(36) NOT NULL PRIMARY KEY`);
        await queryRunner.query(`ALTER TABLE \`shipment_not_in_files\` DROP COLUMN \`subsidiaryId\``);
        await queryRunner.query(`ALTER TABLE \`shipment_not_in_files\` ADD \`subsidiaryId\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`shipment_not_in_files\` ADD CONSTRAINT \`FK_85bf85a5de1bbcc0893b9e79bee\` FOREIGN KEY (\`subsidiaryId\`) REFERENCES \`subsidiary\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`shipment_not_in_files\` ADD CONSTRAINT \`FK_809e04ea64f7b6a6bce53aaa43c\` FOREIGN KEY (\`dispatchId\`) REFERENCES \`package_dispatch\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`shipment_not_in_files\` DROP FOREIGN KEY \`FK_809e04ea64f7b6a6bce53aaa43c\``);
        await queryRunner.query(`ALTER TABLE \`shipment_not_in_files\` DROP FOREIGN KEY \`FK_85bf85a5de1bbcc0893b9e79bee\``);
        await queryRunner.query(`ALTER TABLE \`shipment_not_in_files\` DROP COLUMN \`subsidiaryId\``);
        await queryRunner.query(`ALTER TABLE \`shipment_not_in_files\` ADD \`subsidiaryId\` char(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`shipment_not_in_files\` DROP COLUMN \`id\``);
        await queryRunner.query(`ALTER TABLE \`shipment_not_in_files\` ADD \`id\` char(36) NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`shipment_not_in_files\` ADD PRIMARY KEY (\`id\`)`);
        await queryRunner.query(`ALTER TABLE \`shipment_not_in_files\` DROP COLUMN \`dispatchId\``);
        await queryRunner.query(`ALTER TABLE \`shipment_not_in_files\` ADD CONSTRAINT \`FK_shipment_not_in_files_subsidiary\` FOREIGN KEY (\`subsidiaryId\`) REFERENCES \`subsidiary\`(\`id\`) ON DELETE SET NULL ON UPDATE CASCADE`);
        
    }
}

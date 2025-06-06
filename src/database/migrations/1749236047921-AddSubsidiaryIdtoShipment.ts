import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSubsidiaryIdtoShipment1749236047921 implements MigrationInterface {
    name = 'AddSubsidiaryIdtoShipment1749236047921'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`shipment\` ADD \`subsidiaryId\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`shipment\` ADD CONSTRAINT \`FK_879bdd4a2a6d42e9f28acaebceb\` FOREIGN KEY (\`subsidiaryId\`) REFERENCES \`subsidiary\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`shipment\` DROP FOREIGN KEY \`FK_879bdd4a2a6d42e9f28acaebceb\``);
        await queryRunner.query(`ALTER TABLE \`shipment\` DROP COLUMN \`subsidiaryId\``);
    }

}

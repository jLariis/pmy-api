import { MigrationInterface, QueryRunner } from "typeorm";

export class AddNulleableToVehicleOnPackageDispatch1754680156511 implements MigrationInterface {
    name = 'AddNulleableToVehicleOnPackageDispatch1754680156511'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`package_dispatch\` DROP FOREIGN KEY \`FK_4428514a69b75a39d8712c33a6e\``);
        await queryRunner.query(`ALTER TABLE \`package_dispatch\` ADD CONSTRAINT \`FK_4428514a69b75a39d8712c33a6e\` FOREIGN KEY (\`vehicleId\`) REFERENCES \`vehicle\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`package_dispatch\` DROP FOREIGN KEY \`FK_4428514a69b75a39d8712c33a6e\``);
        await queryRunner.query(`ALTER TABLE \`package_dispatch\` ADD CONSTRAINT \`FK_4428514a69b75a39d8712c33a6e\` FOREIGN KEY (\`vehicleId\`) REFERENCES \`vehicle\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

}

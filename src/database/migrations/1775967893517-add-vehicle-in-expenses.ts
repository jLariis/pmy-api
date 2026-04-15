import { MigrationInterface, QueryRunner } from "typeorm";

export class AddVehicleInExpenses1775967893517 implements MigrationInterface {
    name = 'AddVehicleInExpenses1775967893517'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`expense\` ADD \`vehicleId\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`expense\` ADD CONSTRAINT \`FK_e5c79ef78e83c1adaa8df85c1aa\` FOREIGN KEY (\`vehicleId\`) REFERENCES \`vehicle\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`expense\` DROP FOREIGN KEY \`FK_e5c79ef78e83c1adaa8df85c1aa\``);
        await queryRunner.query(`ALTER TABLE \`expense\` DROP COLUMN \`vehicleId\``);
    }

}

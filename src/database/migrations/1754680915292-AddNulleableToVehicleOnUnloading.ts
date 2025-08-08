import { MigrationInterface, QueryRunner } from "typeorm";

export class AddNulleableToVehicleOnUnloading1754680915292 implements MigrationInterface {
    name = 'AddNulleableToVehicleOnUnloading1754680915292'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`unloading\` DROP FOREIGN KEY \`FK_ed0ca4d79fe9b319ebff0d6cff6\``);
        await queryRunner.query(`ALTER TABLE \`unloading\` ADD CONSTRAINT \`FK_ed0ca4d79fe9b319ebff0d6cff6\` FOREIGN KEY (\`vehicleId\`) REFERENCES \`vehicle\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`unloading\` DROP FOREIGN KEY \`FK_ed0ca4d79fe9b319ebff0d6cff6\``);
        await queryRunner.query(`ALTER TABLE \`unloading\` ADD CONSTRAINT \`FK_ed0ca4d79fe9b319ebff0d6cff6\` FOREIGN KEY (\`vehicleId\`) REFERENCES \`vehicle\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

}

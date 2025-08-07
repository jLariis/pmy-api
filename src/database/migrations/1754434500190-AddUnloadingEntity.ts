import { MigrationInterface, QueryRunner } from "typeorm";

export class AddUnloadingEntity1754434500190 implements MigrationInterface {
    name = 'AddUnloadingEntity1754434500190'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`unloading\` (\`id\` varchar(36) NOT NULL, \`missingTrackings\` json NOT NULL, \`unScannedTrackings\` json NOT NULL, \`date\` timestamp NULL, \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, \`vehicleId\` varchar(36) NULL, \`subsidiaryId\` varchar(36) NULL, PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`unloading\` ADD CONSTRAINT \`FK_ed0ca4d79fe9b319ebff0d6cff6\` FOREIGN KEY (\`vehicleId\`) REFERENCES \`vehicle\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`unloading\` ADD CONSTRAINT \`FK_c720b28da4c6f8ab86d0af4fab7\` FOREIGN KEY (\`subsidiaryId\`) REFERENCES \`subsidiary\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`unloading\` DROP FOREIGN KEY \`FK_c720b28da4c6f8ab86d0af4fab7\``);
        await queryRunner.query(`ALTER TABLE \`unloading\` DROP FOREIGN KEY \`FK_ed0ca4d79fe9b319ebff0d6cff6\``);
        await queryRunner.query(`DROP TABLE \`unloading\``);
    }

}

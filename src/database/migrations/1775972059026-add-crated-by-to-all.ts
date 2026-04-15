import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCratedByToAll1775972059026 implements MigrationInterface {
    name = 'AddCratedByToAll1775972059026'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`route_closure\` DROP FOREIGN KEY \`FK_40845e32467cc174697915b0ea3\``);

        await queryRunner.query(`ALTER TABLE \`route_closure\` CHANGE \`created_by_user_id\` \`createdById\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`package_dispatch\` CHANGE \`createdBy\` \`createdById\` varchar(36) NULL`);

        await queryRunner.query(`ALTER TABLE \`subsidiary\` ADD \`createdById\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`charge\` ADD \`createdById\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`driver\` ADD \`createdById\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`route\` ADD \`createdById\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`vehicle\` ADD \`createdById\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`unloading\` ADD \`createdById\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`inventory\` ADD \`createdById\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`consolidated\` ADD \`createdById\` varchar(36) NULL`);

        await queryRunner.query(`ALTER TABLE \`subsidiary\` ADD CONSTRAINT \`FK_d4be62f1cecf4f38cf6d33afcc3\` FOREIGN KEY (\`createdById\`) REFERENCES \`user\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`charge\` ADD CONSTRAINT \`FK_7b03b2b5cf31160aa6f63742168\` FOREIGN KEY (\`createdById\`) REFERENCES \`user\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`driver\` ADD CONSTRAINT \`FK_1817f64bd1501f8aff5acdc5ec0\` FOREIGN KEY (\`createdById\`) REFERENCES \`user\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`route\` ADD CONSTRAINT \`FK_483b0bbe46bd94edc2e6711730b\` FOREIGN KEY (\`createdById\`) REFERENCES \`user\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`vehicle\` ADD CONSTRAINT \`FK_e49ed03cdca420d7c5080c78554\` FOREIGN KEY (\`createdById\`) REFERENCES \`user\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`route_closure\` ADD CONSTRAINT \`FK_07b28397771c15567596d4a83e7\` FOREIGN KEY (\`createdById\`) REFERENCES \`user\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`package_dispatch\` ADD CONSTRAINT \`FK_de2791ebd738e12f070995b5151\` FOREIGN KEY (\`createdById\`) REFERENCES \`user\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`unloading\` ADD CONSTRAINT \`FK_aa5e7f930c7dfd614242847d3e4\` FOREIGN KEY (\`createdById\`) REFERENCES \`user\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`inventory\` ADD CONSTRAINT \`FK_a35b2af7fa30e71e4229e3d4e22\` FOREIGN KEY (\`createdById\`) REFERENCES \`user\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`consolidated\` ADD CONSTRAINT \`FK_85fb920d5a3549fa15a28f4a7da\` FOREIGN KEY (\`createdById\`) REFERENCES \`user\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`consolidated\` DROP FOREIGN KEY \`FK_85fb920d5a3549fa15a28f4a7da\``);
        await queryRunner.query(`ALTER TABLE \`inventory\` DROP FOREIGN KEY \`FK_a35b2af7fa30e71e4229e3d4e22\``);
        await queryRunner.query(`ALTER TABLE \`unloading\` DROP FOREIGN KEY \`FK_aa5e7f930c7dfd614242847d3e4\``);
        await queryRunner.query(`ALTER TABLE \`package_dispatch\` DROP FOREIGN KEY \`FK_de2791ebd738e12f070995b5151\``);
        await queryRunner.query(`ALTER TABLE \`route_closure\` DROP FOREIGN KEY \`FK_07b28397771c15567596d4a83e7\``);
        await queryRunner.query(`ALTER TABLE \`vehicle\` DROP FOREIGN KEY \`FK_e49ed03cdca420d7c5080c78554\``);
        await queryRunner.query(`ALTER TABLE \`route\` DROP FOREIGN KEY \`FK_483b0bbe46bd94edc2e6711730b\``);
        await queryRunner.query(`ALTER TABLE \`driver\` DROP FOREIGN KEY \`FK_1817f64bd1501f8aff5acdc5ec0\``);
        await queryRunner.query(`ALTER TABLE \`charge\` DROP FOREIGN KEY \`FK_7b03b2b5cf31160aa6f63742168\``);
        await queryRunner.query(`ALTER TABLE \`subsidiary\` DROP FOREIGN KEY \`FK_d4be62f1cecf4f38cf6d33afcc3\``);

        await queryRunner.query(`ALTER TABLE \`consolidated\` DROP COLUMN \`createdById\``);
        await queryRunner.query(`ALTER TABLE \`inventory\` DROP COLUMN \`createdById\``);
        await queryRunner.query(`ALTER TABLE \`unloading\` DROP COLUMN \`createdById\``);
        await queryRunner.query(`ALTER TABLE \`vehicle\` DROP COLUMN \`createdById\``);
        await queryRunner.query(`ALTER TABLE \`route\` DROP COLUMN \`createdById\``);
        await queryRunner.query(`ALTER TABLE \`driver\` DROP COLUMN \`createdById\``);
        await queryRunner.query(`ALTER TABLE \`charge\` DROP COLUMN \`createdById\``);
        await queryRunner.query(`ALTER TABLE \`subsidiary\` DROP COLUMN \`createdById\``);

        await queryRunner.query(`ALTER TABLE \`package_dispatch\` CHANGE \`createdById\` \`createdBy\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`route_closure\` CHANGE \`createdById\` \`created_by_user_id\` varchar(36) NULL`);

        await queryRunner.query(`ALTER TABLE \`route_closure\` ADD CONSTRAINT \`FK_40845e32467cc174697915b0ea3\` FOREIGN KEY (\`created_by_user_id\`) REFERENCES \`user\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }
}
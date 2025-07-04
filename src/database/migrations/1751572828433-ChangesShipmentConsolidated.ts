import { MigrationInterface, QueryRunner } from "typeorm";

export class ChangesShipmentConsolidated1751572828433 implements MigrationInterface {
    name = 'ChangesShipmentConsolidated1751572828433'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`consolidated\` (\`id\` varchar(36) NOT NULL, \`date\` varchar(255) NOT NULL, \`type\` enum ('ordinario', 'carga', 'aereo') NOT NULL DEFAULT 'ordinario', \`numberOfPackages\` int NOT NULL, \`subsidiaryId\` varchar(255) NULL, \`isCompleted\` tinyint NOT NULL, \`consNumber\` varchar(255) NULL, \`efficiency\` int NULL DEFAULT '0', \`createdAt\` varchar(255) NULL, PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`consolidated\` ADD CONSTRAINT \`FK_4f6256c34689272c1945cb46767\` FOREIGN KEY (\`subsidiaryId\`) REFERENCES \`subsidiary\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`consolidated\` DROP FOREIGN KEY \`FK_4f6256c34689272c1945cb46767\``);
        await queryRunner.query(`DROP TABLE \`consolidated\``);
    }

}

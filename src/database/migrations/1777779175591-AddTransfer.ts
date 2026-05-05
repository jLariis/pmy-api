import { MigrationInterface, QueryRunner } from "typeorm";

export class AddTransfer1777779175591 implements MigrationInterface {
    name = 'AddTransfer1777779175591'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`transfer\` (\`id\` varchar(36) NOT NULL, \`originId\` varchar(255) NULL, \`destinationId\` varchar(255) NULL, \`otherDestination\` varchar(255) NULL, \`amount\` decimal(10,2) NOT NULL DEFAULT '0.00', \`transferType\` varchar(50) NOT NULL, \`otherTransferType\` varchar(255) NULL, \`status\` varchar(50) NOT NULL DEFAULT 'PENDING', \`createdById\` varchar(255) NULL, \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP, \`vehicleId\` varchar(36) NULL, INDEX \`IDX_fd9ddbdd49a17afcbe01440129\` (\`id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`transfer_drivers\` (\`transferId\` varchar(36) NOT NULL, \`driverId\` varchar(36) NOT NULL, INDEX \`IDX_135df8d6cc1041716150d3359c\` (\`transferId\`), INDEX \`IDX_79061a908402d5d3b3d33f3ce0\` (\`driverId\`), PRIMARY KEY (\`transferId\`, \`driverId\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`transfer\` ADD CONSTRAINT \`FK_382b2823923dafcd49a77157013\` FOREIGN KEY (\`originId\`) REFERENCES \`subsidiary\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`transfer\` ADD CONSTRAINT \`FK_24f8fafbe50e87e314634954a1b\` FOREIGN KEY (\`destinationId\`) REFERENCES \`subsidiary\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`transfer\` ADD CONSTRAINT \`FK_98a015094d0529450929eb9b4ea\` FOREIGN KEY (\`vehicleId\`) REFERENCES \`vehicle\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`transfer\` ADD CONSTRAINT \`FK_05a7544bb3f1f6055db69da970c\` FOREIGN KEY (\`createdById\`) REFERENCES \`user\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`transfer_drivers\` ADD CONSTRAINT \`FK_135df8d6cc1041716150d3359cc\` FOREIGN KEY (\`transferId\`) REFERENCES \`transfer\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`transfer_drivers\` ADD CONSTRAINT \`FK_79061a908402d5d3b3d33f3ce0e\` FOREIGN KEY (\`driverId\`) REFERENCES \`driver\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`transfer_drivers\` DROP FOREIGN KEY \`FK_79061a908402d5d3b3d33f3ce0e\``);
        await queryRunner.query(`ALTER TABLE \`transfer_drivers\` DROP FOREIGN KEY \`FK_135df8d6cc1041716150d3359cc\``);
        await queryRunner.query(`ALTER TABLE \`transfer\` DROP FOREIGN KEY \`FK_05a7544bb3f1f6055db69da970c\``);
        await queryRunner.query(`ALTER TABLE \`transfer\` DROP FOREIGN KEY \`FK_98a015094d0529450929eb9b4ea\``);
        await queryRunner.query(`ALTER TABLE \`transfer\` DROP FOREIGN KEY \`FK_24f8fafbe50e87e314634954a1b\``);
        await queryRunner.query(`ALTER TABLE \`transfer\` DROP FOREIGN KEY \`FK_382b2823923dafcd49a77157013\``);
        await queryRunner.query(`DROP INDEX \`IDX_79061a908402d5d3b3d33f3ce0\` ON \`transfer_drivers\``);
        await queryRunner.query(`DROP INDEX \`IDX_135df8d6cc1041716150d3359c\` ON \`transfer_drivers\``);
        await queryRunner.query(`DROP TABLE \`transfer_drivers\``);
        await queryRunner.query(`DROP INDEX \`IDX_fd9ddbdd49a17afcbe01440129\` ON \`transfer\``);
        await queryRunner.query(`DROP TABLE \`transfer\``);
    }

}

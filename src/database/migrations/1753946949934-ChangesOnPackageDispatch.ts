import { MigrationInterface, QueryRunner } from "typeorm";

export class ChangesOnPackageDispatch1753946949934 implements MigrationInterface {
    name = 'ChangesOnPackageDispatch1753946949934'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`shipment\` DROP FOREIGN KEY \`FK_8ac3723c1ac2e28f39e22cedfc1\``);
        await queryRunner.query(`ALTER TABLE \`charge_shipment\` DROP FOREIGN KEY \`FK_c382abb4bdfcbeb2ed82671d366\``);
        await queryRunner.query(`CREATE TABLE \`package_dispatch\` (\`id\` varchar(36) NOT NULL, \`dispatchNumber\` varchar(255) NOT NULL, \`status\` enum ('Pendiente', 'En progreso', 'Completada', 'Cancelada') NOT NULL DEFAULT 'En progreso', \`startTime\` timestamp NULL, \`estimatedArrival\` timestamp NULL, \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, \`updatedAt\` timestamp NULL, \`vehicleId\` varchar(36) NULL, \`subsidiaryId\` varchar(36) NULL, UNIQUE INDEX \`IDX_8912031ffe4a797858d0d203a5\` (\`dispatchNumber\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`package_dispatch_routes\` (\`dispatchId\` varchar(36) NOT NULL, \`routeId\` varchar(36) NOT NULL, INDEX \`IDX_f75ab7c098966d227235bbba65\` (\`dispatchId\`), INDEX \`IDX_81625b956b524f4215de070837\` (\`routeId\`), PRIMARY KEY (\`dispatchId\`, \`routeId\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`package_dispatch_drivers\` (\`dispatchId\` varchar(36) NOT NULL, \`driverId\` varchar(36) NOT NULL, INDEX \`IDX_b7863b3a8b7f7b9215ac747020\` (\`dispatchId\`), INDEX \`IDX_4e74bdb543499117ad3a916eae\` (\`driverId\`), PRIMARY KEY (\`dispatchId\`, \`driverId\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`package_dispatch\` ADD CONSTRAINT \`FK_4428514a69b75a39d8712c33a6e\` FOREIGN KEY (\`vehicleId\`) REFERENCES \`vehicle\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`package_dispatch\` ADD CONSTRAINT \`FK_934827a5d2774ce027c52ed8f79\` FOREIGN KEY (\`subsidiaryId\`) REFERENCES \`subsidiary\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`shipment\` ADD CONSTRAINT \`FK_8ac3723c1ac2e28f39e22cedfc1\` FOREIGN KEY (\`routeId\`) REFERENCES \`package_dispatch\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`charge_shipment\` ADD CONSTRAINT \`FK_c382abb4bdfcbeb2ed82671d366\` FOREIGN KEY (\`routeId\`) REFERENCES \`package_dispatch\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`package_dispatch_routes\` ADD CONSTRAINT \`FK_f75ab7c098966d227235bbba65a\` FOREIGN KEY (\`dispatchId\`) REFERENCES \`package_dispatch\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`package_dispatch_routes\` ADD CONSTRAINT \`FK_81625b956b524f4215de070837e\` FOREIGN KEY (\`routeId\`) REFERENCES \`route\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`package_dispatch_drivers\` ADD CONSTRAINT \`FK_b7863b3a8b7f7b9215ac7470202\` FOREIGN KEY (\`dispatchId\`) REFERENCES \`package_dispatch\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`package_dispatch_drivers\` ADD CONSTRAINT \`FK_4e74bdb543499117ad3a916eaeb\` FOREIGN KEY (\`driverId\`) REFERENCES \`driver\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`package_dispatch_drivers\` DROP FOREIGN KEY \`FK_4e74bdb543499117ad3a916eaeb\``);
        await queryRunner.query(`ALTER TABLE \`package_dispatch_drivers\` DROP FOREIGN KEY \`FK_b7863b3a8b7f7b9215ac7470202\``);
        await queryRunner.query(`ALTER TABLE \`package_dispatch_routes\` DROP FOREIGN KEY \`FK_81625b956b524f4215de070837e\``);
        await queryRunner.query(`ALTER TABLE \`package_dispatch_routes\` DROP FOREIGN KEY \`FK_f75ab7c098966d227235bbba65a\``);
        await queryRunner.query(`ALTER TABLE \`charge_shipment\` DROP FOREIGN KEY \`FK_c382abb4bdfcbeb2ed82671d366\``);
        await queryRunner.query(`ALTER TABLE \`shipment\` DROP FOREIGN KEY \`FK_8ac3723c1ac2e28f39e22cedfc1\``);
        await queryRunner.query(`ALTER TABLE \`package_dispatch\` DROP FOREIGN KEY \`FK_934827a5d2774ce027c52ed8f79\``);
        await queryRunner.query(`ALTER TABLE \`package_dispatch\` DROP FOREIGN KEY \`FK_4428514a69b75a39d8712c33a6e\``);
        await queryRunner.query(`DROP INDEX \`IDX_4e74bdb543499117ad3a916eae\` ON \`package_dispatch_drivers\``);
        await queryRunner.query(`DROP INDEX \`IDX_b7863b3a8b7f7b9215ac747020\` ON \`package_dispatch_drivers\``);
        await queryRunner.query(`DROP TABLE \`package_dispatch_drivers\``);
        await queryRunner.query(`DROP INDEX \`IDX_81625b956b524f4215de070837\` ON \`package_dispatch_routes\``);
        await queryRunner.query(`DROP INDEX \`IDX_f75ab7c098966d227235bbba65\` ON \`package_dispatch_routes\``);
        await queryRunner.query(`DROP TABLE \`package_dispatch_routes\``);
        await queryRunner.query(`DROP INDEX \`IDX_8912031ffe4a797858d0d203a5\` ON \`package_dispatch\``);
        await queryRunner.query(`DROP TABLE \`package_dispatch\``);
        await queryRunner.query(`ALTER TABLE \`charge_shipment\` ADD CONSTRAINT \`FK_c382abb4bdfcbeb2ed82671d366\` FOREIGN KEY (\`routeId\`) REFERENCES \`package-dispatch\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`shipment\` ADD CONSTRAINT \`FK_8ac3723c1ac2e28f39e22cedfc1\` FOREIGN KEY (\`routeId\`) REFERENCES \`package-dispatch\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

}

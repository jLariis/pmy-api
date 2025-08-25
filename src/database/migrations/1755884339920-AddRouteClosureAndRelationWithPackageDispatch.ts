import { MigrationInterface, QueryRunner } from "typeorm";

export class AddRouteClosureAndRelationWithPackageDispatch1755884339920 implements MigrationInterface {
    name = 'AddRouteClosureAndRelationWithPackageDispatch1755884339920'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`route_closure\` (\`id\` varchar(36) NOT NULL, \`closeDate\` timestamp NOT NULL, \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, \`package_dispatch_id\` varchar(36) NULL, \`created_by_user_id\` varchar(36) NULL, \`subsidiaryId\` varchar(36) NULL, UNIQUE INDEX \`REL_1848fa10228dd913332f30d5e1\` (\`package_dispatch_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`route_closure_returned_packages\` (\`route_closure_id\` varchar(36) NOT NULL, \`shipment_id\` varchar(36) NOT NULL, INDEX \`IDX_53675041544d60abc6bde68ce1\` (\`route_closure_id\`), INDEX \`IDX_bde20da15c9de227259b8835be\` (\`shipment_id\`), PRIMARY KEY (\`route_closure_id\`, \`shipment_id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`route_closure_pod_packages\` (\`route_closure_id\` varchar(36) NOT NULL, \`shipment_id\` varchar(36) NOT NULL, INDEX \`IDX_3c04fbfbc5eb793bbee971bc78\` (\`route_closure_id\`), INDEX \`IDX_00229ce5bbaf51f354ac758dc8\` (\`shipment_id\`), PRIMARY KEY (\`route_closure_id\`, \`shipment_id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`unloading\` ADD UNIQUE INDEX \`IDX_c4c4fec7dfe37214dd95410c84\` (\`trackingNumber\`)`);
        await queryRunner.query(`ALTER TABLE \`route_closure\` ADD CONSTRAINT \`FK_1848fa10228dd913332f30d5e1b\` FOREIGN KEY (\`package_dispatch_id\`) REFERENCES \`package_dispatch\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`route_closure\` ADD CONSTRAINT \`FK_40845e32467cc174697915b0ea3\` FOREIGN KEY (\`created_by_user_id\`) REFERENCES \`user\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`route_closure\` ADD CONSTRAINT \`FK_f8061b790a5abca4c2a15c44ebd\` FOREIGN KEY (\`subsidiaryId\`) REFERENCES \`subsidiary\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`route_closure_returned_packages\` ADD CONSTRAINT \`FK_53675041544d60abc6bde68ce12\` FOREIGN KEY (\`route_closure_id\`) REFERENCES \`route_closure\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`route_closure_returned_packages\` ADD CONSTRAINT \`FK_bde20da15c9de227259b8835be4\` FOREIGN KEY (\`shipment_id\`) REFERENCES \`shipment\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`route_closure_pod_packages\` ADD CONSTRAINT \`FK_3c04fbfbc5eb793bbee971bc78f\` FOREIGN KEY (\`route_closure_id\`) REFERENCES \`route_closure\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`route_closure_pod_packages\` ADD CONSTRAINT \`FK_00229ce5bbaf51f354ac758dc84\` FOREIGN KEY (\`shipment_id\`) REFERENCES \`shipment\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`route_closure_pod_packages\` DROP FOREIGN KEY \`FK_00229ce5bbaf51f354ac758dc84\``);
        await queryRunner.query(`ALTER TABLE \`route_closure_pod_packages\` DROP FOREIGN KEY \`FK_3c04fbfbc5eb793bbee971bc78f\``);
        await queryRunner.query(`ALTER TABLE \`route_closure_returned_packages\` DROP FOREIGN KEY \`FK_bde20da15c9de227259b8835be4\``);
        await queryRunner.query(`ALTER TABLE \`route_closure_returned_packages\` DROP FOREIGN KEY \`FK_53675041544d60abc6bde68ce12\``);
        await queryRunner.query(`ALTER TABLE \`route_closure\` DROP FOREIGN KEY \`FK_f8061b790a5abca4c2a15c44ebd\``);
        await queryRunner.query(`ALTER TABLE \`route_closure\` DROP FOREIGN KEY \`FK_40845e32467cc174697915b0ea3\``);
        await queryRunner.query(`ALTER TABLE \`route_closure\` DROP FOREIGN KEY \`FK_1848fa10228dd913332f30d5e1b\``);
        await queryRunner.query(`ALTER TABLE \`unloading\` DROP INDEX \`IDX_c4c4fec7dfe37214dd95410c84\``);
        await queryRunner.query(`DROP INDEX \`IDX_00229ce5bbaf51f354ac758dc8\` ON \`route_closure_pod_packages\``);
        await queryRunner.query(`DROP INDEX \`IDX_3c04fbfbc5eb793bbee971bc78\` ON \`route_closure_pod_packages\``);
        await queryRunner.query(`DROP TABLE \`route_closure_pod_packages\``);
        await queryRunner.query(`DROP INDEX \`IDX_bde20da15c9de227259b8835be\` ON \`route_closure_returned_packages\``);
        await queryRunner.query(`DROP INDEX \`IDX_53675041544d60abc6bde68ce1\` ON \`route_closure_returned_packages\``);
        await queryRunner.query(`DROP TABLE \`route_closure_returned_packages\``);
        await queryRunner.query(`DROP INDEX \`REL_1848fa10228dd913332f30d5e1\` ON \`route_closure\``);
        await queryRunner.query(`DROP TABLE \`route_closure\``);
    }

}

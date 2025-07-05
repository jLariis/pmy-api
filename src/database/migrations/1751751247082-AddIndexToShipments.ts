import { MigrationInterface, QueryRunner } from "typeorm";

export class AddIndexToShipments1751751247082 implements MigrationInterface {
    name = 'AddIndexToShipments1751751247082'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE INDEX \`IDX_9d10df77c954dfee00e7eff6e2\` ON \`shipment_status\` (\`exceptionCode\`)`);
        await queryRunner.query(`CREATE INDEX \`IDX_f51f635db95c534ca206bf7a0a\` ON \`shipment\` (\`id\`)`);
        await queryRunner.query(`CREATE INDEX \`IDX_64ef33a345ed0e4913be364c2f\` ON \`shipment\` (\`shipmentType\`)`);
        await queryRunner.query(`CREATE INDEX \`IDX_75b5f089f72a5671a4f65efbcc\` ON \`shipment\` (\`status\`)`);
        await queryRunner.query(`CREATE INDEX \`IDX_879bdd4a2a6d42e9f28acaebce\` ON \`shipment\` (\`subsidiaryId\`)`);
        await queryRunner.query(`CREATE INDEX \`IDX_8201851a2dcd46de14f7321508\` ON \`shipment\` (\`consolidatedId\`)`);
        await queryRunner.query(`CREATE INDEX \`IDX_442921a04f796f33d2db5b6f9e\` ON \`income\` (\`shipmentId\`)`);
        await queryRunner.query(`CREATE INDEX \`IDX_5f9c4c7aaff3a1e574564d3515\` ON \`income\` (\`collectionId\`)`);
        await queryRunner.query(`CREATE INDEX \`IDX_56233bfdf69db4cc7499bede3e\` ON \`income\` (\`chargeId\`)`);
        await queryRunner.query(`CREATE INDEX \`IDX_eccad879897f6ff58855688f20\` ON \`charge_shipment\` (\`id\`)`);
        await queryRunner.query(`CREATE INDEX \`IDX_b7ad5e8359133a6f1bc9eba3c7\` ON \`charge_shipment\` (\`shipmentType\`)`);
        await queryRunner.query(`CREATE INDEX \`IDX_38080cd177fe3bfe59c7f806e4\` ON \`charge_shipment\` (\`status\`)`);
        await queryRunner.query(`CREATE INDEX \`IDX_64915b43e255e3edabef6eef1b\` ON \`charge_shipment\` (\`subsidiaryId\`)`);
        await queryRunner.query(`CREATE INDEX \`IDX_3046ad61ae7e233865b63aa005\` ON \`charge_shipment\` (\`consolidatedId\`)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX \`IDX_3046ad61ae7e233865b63aa005\` ON \`charge_shipment\``);
        await queryRunner.query(`DROP INDEX \`IDX_64915b43e255e3edabef6eef1b\` ON \`charge_shipment\``);
        await queryRunner.query(`DROP INDEX \`IDX_38080cd177fe3bfe59c7f806e4\` ON \`charge_shipment\``);
        await queryRunner.query(`DROP INDEX \`IDX_b7ad5e8359133a6f1bc9eba3c7\` ON \`charge_shipment\``);
        await queryRunner.query(`DROP INDEX \`IDX_eccad879897f6ff58855688f20\` ON \`charge_shipment\``);
        await queryRunner.query(`DROP INDEX \`IDX_56233bfdf69db4cc7499bede3e\` ON \`income\``);
        await queryRunner.query(`DROP INDEX \`IDX_5f9c4c7aaff3a1e574564d3515\` ON \`income\``);
        await queryRunner.query(`DROP INDEX \`IDX_442921a04f796f33d2db5b6f9e\` ON \`income\``);
        await queryRunner.query(`DROP INDEX \`IDX_8201851a2dcd46de14f7321508\` ON \`shipment\``);
        await queryRunner.query(`DROP INDEX \`IDX_879bdd4a2a6d42e9f28acaebce\` ON \`shipment\``);
        await queryRunner.query(`DROP INDEX \`IDX_75b5f089f72a5671a4f65efbcc\` ON \`shipment\``);
        await queryRunner.query(`DROP INDEX \`IDX_64ef33a345ed0e4913be364c2f\` ON \`shipment\``);
        await queryRunner.query(`DROP INDEX \`IDX_f51f635db95c534ca206bf7a0a\` ON \`shipment\``);
        await queryRunner.query(`DROP INDEX \`IDX_9d10df77c954dfee00e7eff6e2\` ON \`shipment_status\``);
    }

}

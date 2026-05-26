import { MigrationInterface, QueryRunner } from "typeorm";

export class AddZoneToSubsidiary1779774240465 implements MigrationInterface {
    name = 'AddZoneToSubsidiary1779774240465'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Agregar columna zoneId a subsidiary
        await queryRunner.query(`
            ALTER TABLE \`subsidiary\`
            ADD \`zoneId\` varchar(36) NULL
        `);

        // Crear índice para zoneId
        await queryRunner.query(`
            CREATE INDEX \`IDX_subsidiary_zoneId\`
            ON \`subsidiary\` (\`zoneId\`)
        `);

        // Crear foreign key subsidiary.zoneId -> zone.id
        await queryRunner.query(`
            ALTER TABLE \`subsidiary\`
            ADD CONSTRAINT \`FK_subsidiary_zone\`
            FOREIGN KEY (\`zoneId\`)
            REFERENCES \`zone\`(\`id\`)
            ON DELETE SET NULL
            ON UPDATE NO ACTION
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Eliminar foreign key
        await queryRunner.query(`
            ALTER TABLE \`subsidiary\`
            DROP FOREIGN KEY \`FK_subsidiary_zone\`
        `);

        // Eliminar índice
        await queryRunner.query(`
            DROP INDEX \`IDX_subsidiary_zoneId\`
            ON \`subsidiary\`
        `);

        // Eliminar columna
        await queryRunner.query(`
            ALTER TABLE \`subsidiary\`
            DROP COLUMN \`zoneId\`
        `);
    }
}

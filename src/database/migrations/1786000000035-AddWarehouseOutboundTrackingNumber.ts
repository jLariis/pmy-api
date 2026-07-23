import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Agrega `trackingNumber` (folio) a `warehouse_outbound`. Los traspasos no
 * tenían folio propio, por lo que el PDF/Excel salía con "SEGUIMIENTO" vacío.
 * Nullable + UNIQUE: las filas históricas quedan NULL (MySQL permite múltiples
 * NULL en un índice UNIQUE) y los nuevos traspasos generan un folio único.
 */
export class AddWarehouseOutboundTrackingNumber1786000000035 implements MigrationInterface {
  name = 'AddWarehouseOutboundTrackingNumber1786000000035'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`warehouse_outbound\`
      ADD \`trackingNumber\` varchar(20) NULL
    `);
    await queryRunner.query(`
      ALTER TABLE \`warehouse_outbound\`
      ADD UNIQUE INDEX \`UQ_warehouse_outbound_trackingNumber\` (\`trackingNumber\`)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`warehouse_outbound\`
      DROP INDEX \`UQ_warehouse_outbound_trackingNumber\`
    `);
    await queryRunner.query(`
      ALTER TABLE \`warehouse_outbound\`
      DROP COLUMN \`trackingNumber\`
    `);
  }
}

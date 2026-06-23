import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Índices para acelerar reportes y resolución de duplicados:
 *  - shipment_status(exceptionCode, timestamp): clave para el reporte "con 67"
 *    (filtra el evento 67 dentro de un rango sobre ~3M filas).
 *  - shipment(trackingNumber): la tabla NO tenía índice por guía; lo usan la
 *    resolución de duplicados (más reciente por createdAt), pendientes y reportes.
 */
export class AddReportingIndexes1786000000004 implements MigrationInterface {
  name = 'AddReportingIndexes1786000000004'

  private async hasIndex(qr: QueryRunner, table: string, name: string): Promise<boolean> {
    const rows: any[] = await qr.query(`SHOW INDEX FROM \`${table}\` WHERE Key_name = ?`, [name]);
    return rows.length > 0;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await this.hasIndex(queryRunner, 'shipment_status', 'idx_ss_excode_ts'))) {
      await queryRunner.query("CREATE INDEX `idx_ss_excode_ts` ON `shipment_status` (`exceptionCode`, `timestamp`)");
    }
    if (!(await this.hasIndex(queryRunner, 'shipment', 'idx_shipment_trackingNumber'))) {
      await queryRunner.query("CREATE INDEX `idx_shipment_trackingNumber` ON `shipment` (`trackingNumber`)");
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await this.hasIndex(queryRunner, 'shipment_status', 'idx_ss_excode_ts')) {
      await queryRunner.query("DROP INDEX `idx_ss_excode_ts` ON `shipment_status`");
    }
    if (await this.hasIndex(queryRunner, 'shipment', 'idx_shipment_trackingNumber')) {
      await queryRunner.query("DROP INDEX `idx_shipment_trackingNumber` ON `shipment`");
    }
  }
}

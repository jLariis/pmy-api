import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Eventos FedEx PRE-REGISTRO del mismo día:
 *  - `subsidiary.allowSameDayPreRegistrationFedexEvents`: si está activo, los
 *    eventos de FedEx (DEX 07/08, cambio de fecha, dirección incorrecta, etc.)
 *    ANTERIORES a `shipment.createdAt` pero del MISMO DÍA calendario (zona
 *    Hermosillo) SÍ entran al pipeline de historial/ingresos. Sirve para las
 *    sucursales que operan desde la bodega de FedEx, donde FedEx puede escanear
 *    el paquete antes de que exista en el sistema.
 *    Default false = comportamiento histórico (esos eventos NO entran).
 *    NO relaja el Time Shield del estatus operativo.
 *  - Seed: activo SOLO para Hermosillo (sucursal, NO "Bodega Hermosillo") y
 *    Cabo San Lucas. Nombre exacto + guard isWarehouse = 0.
 *
 * DEFENSIVA: guard a information_schema por el historial de `synchronize` del
 * proyecto (evita "duplicate column" si un DB_SYNC ya agregó la columna en dev).
 */
export class AddSubsidiarySameDayPreRegFedexEvents1786000000052 implements MigrationInterface {
  name = 'AddSubsidiarySameDayPreRegFedexEvents1786000000052'

  private async columnExists(qr: QueryRunner, table: string, column: string): Promise<boolean> {
    const rows = await qr.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column],
    );
    return Number(rows[0].c) > 0;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await this.columnExists(queryRunner, 'subsidiary', 'allowSameDayPreRegistrationFedexEvents'))) {
      await queryRunner.query(
        `ALTER TABLE \`subsidiary\` ADD COLUMN \`allowSameDayPreRegistrationFedexEvents\` tinyint(1) NOT NULL DEFAULT 0`,
      );
    }

    // Seed: SOLO Hermosillo (NO "Bodega Hermosillo"). Nombre exacto + guard
    // isWarehouse = 0. Otras sucursales (p.ej. Cabos) se pueden habilitar después
    // desde el módulo de Configuración si se requiere.
    await queryRunner.query(
      `UPDATE \`subsidiary\` SET \`allowSameDayPreRegistrationFedexEvents\` = 1
       WHERE \`name\` = 'Hermosillo' AND \`isWarehouse\` = 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await this.columnExists(queryRunner, 'subsidiary', 'allowSameDayPreRegistrationFedexEvents')) {
      await queryRunner.query(
        `ALTER TABLE \`subsidiary\` DROP COLUMN \`allowSameDayPreRegistrationFedexEvents\``,
      );
    }
  }
}

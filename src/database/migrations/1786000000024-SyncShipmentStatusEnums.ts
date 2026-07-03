import { MigrationInterface, QueryRunner } from 'typeorm';
import { ShipmentStatusType } from '../../common/enums/shipment-status-type.enum';

/**
 * Sincroniza las columnas ENUM `status` de `shipment`, `charge_shipment` y
 * `shipment_status` con TODOS los valores de `ShipmentStatusType`. Había drift:
 * las 3 tenían 25 valores y faltaba `restriccion_seguridad_ubicacion` (DEX05),
 * lo que provocaba "Data truncated for column 'status'" al guardar cargos /
 * historial con ese estatus. Se regenera el ENUM completo desde el enum TS
 * (a prueba de futuro: cualquier valor nuevo entra aquí). Preserva default/null.
 */
export class SyncShipmentStatusEnums1786000000024 implements MigrationInterface {
  name = 'SyncShipmentStatusEnums1786000000024';

  public async up(q: QueryRunner): Promise<void> {
    const vals = Object.values(ShipmentStatusType).map((v) => `'${v}'`).join(',');
    await q.query(`ALTER TABLE \`shipment\` MODIFY COLUMN \`status\` ENUM(${vals}) NOT NULL DEFAULT 'pendiente'`);
    await q.query(`ALTER TABLE \`charge_shipment\` MODIFY COLUMN \`status\` ENUM(${vals}) NOT NULL DEFAULT 'pendiente'`);
    await q.query(`ALTER TABLE \`shipment_status\` MODIFY COLUMN \`status\` ENUM(${vals}) NOT NULL`);
  }

  public async down(): Promise<void> {
    // Migración ADITIVA (amplía el ENUM). No se revierte para no romper filas que
    // ya usen los valores nuevos.
  }
}

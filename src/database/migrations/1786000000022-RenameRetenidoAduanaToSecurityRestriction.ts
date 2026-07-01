import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Corrige el estatus DEX05: la descripción real de FedEx es
 * "Location security restrictions - Delivery will be reattempted", NO aduana.
 * Renombra la key `retenido_en_aduana` → `restriccion_seguridad_ubicacion`
 * (etiqueta "Restricción de seguridad en ubicación") en el catálogo y en los
 * datos ya guardados. Idempotente.
 */
export class RenameRetenidoAduanaToSecurityRestriction1786000000022 implements MigrationInterface {
  name = 'RenameRetenidoAduanaToSecurityRestriction1786000000022';

  public async up(q: QueryRunner): Promise<void> {
    const OLD = 'retenido_en_aduana';
    const NEW = 'restriccion_seguridad_ubicacion';
    const LABEL = 'Restricción de seguridad en ubicación';

    // Catálogo: renombra key + label (respeta el UNIQUE type+key).
    await q.query(
      `UPDATE \`catalog_item\` SET \`key\` = ?, \`label\` = ? WHERE \`type\` = 'shipment_status' AND \`key\` = ?`,
      [NEW, LABEL, OLD],
    );
    // Datos ya ingestados con el valor viejo (por si el cron alcanzó a guardar alguno).
    await q.query(`UPDATE \`shipment_status\` SET \`status\` = ? WHERE \`status\` = ?`, [NEW, OLD]);
  }

  public async down(q: QueryRunner): Promise<void> {
    const OLD = 'retenido_en_aduana';
    const NEW = 'restriccion_seguridad_ubicacion';
    await q.query(
      `UPDATE \`catalog_item\` SET \`key\` = ?, \`label\` = ? WHERE \`type\` = 'shipment_status' AND \`key\` = ?`,
      [OLD, 'Retenido en aduana', NEW],
    );
    await q.query(`UPDATE \`shipment_status\` SET \`status\` = ? WHERE \`status\` = ?`, [OLD, NEW]);
  }
}

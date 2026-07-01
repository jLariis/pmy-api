import { MigrationInterface, QueryRunner } from 'typeorm';
import { randomUUID } from 'crypto';

/**
 * Agrega el estatus de envío "Retenido en aduana" (DEX05) al catálogo genérico
 * para que aparezca en Configuración y en los dropdowns que leen del catálogo.
 * Idempotente: no duplica si ya existe. isSystem=1 (lo usa el código).
 */
export class AddRetenidoAduanaCatalogItem1786000000021 implements MigrationInterface {
  name = 'AddRetenidoAduanaCatalogItem1786000000021';

  public async up(q: QueryRunner): Promise<void> {
    const type = 'shipment_status';
    const key = 'retenido_en_aduana';
    const label = 'Retenido en aduana';

    const exists: any[] = await q.query(
      `SELECT COUNT(*) AS c FROM \`catalog_item\` WHERE \`type\` = ? AND \`key\` = ?`,
      [type, key],
    );
    if (Number(exists?.[0]?.c ?? 0) > 0) return;

    const max: any[] = await q.query(
      `SELECT COALESCE(MAX(\`sortOrder\`), -1) AS m FROM \`catalog_item\` WHERE \`type\` = ?`,
      [type],
    );
    const sortOrder = Number(max?.[0]?.m ?? -1) + 1;

    await q.query(
      `INSERT INTO \`catalog_item\` (\`id\`, \`type\`, \`key\`, \`label\`, \`sortOrder\`, \`active\`, \`isSystem\`) VALUES (?, ?, ?, ?, ?, 1, 1)`,
      [randomUUID(), type, key, label, sortOrder],
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DELETE FROM \`catalog_item\` WHERE \`type\` = 'shipment_status' AND \`key\` = 'retenido_en_aduana'`,
    );
  }
}

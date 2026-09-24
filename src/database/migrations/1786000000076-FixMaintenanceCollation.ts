import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Las tablas de Mantenimiento se crearon (074, versión inicial) con `utf8mb4_unicode_ci`, pero las
 * legacy (vehicle, subsidiary, user, expense…) usan el default de la BD (`utf8mb4_0900_ai_ci`).
 * Cualquier JOIN entre ambas fallaba con "Illegal mix of collations" (la lista de solicitudes daba 500).
 * Convierte cada tabla del módulo a la collation de la BD. Idempotente: salta las que ya coinciden.
 */
export class FixMaintenanceCollation1786000000076 implements MigrationInterface {
  name = 'FixMaintenanceCollation1786000000076';

  private static readonly TABLES = [
    'maintenance_service_category', 'maintenance_service', 'supplier', 'supplier_contact', 'maintenance_request',
    'maintenance_quote', 'maintenance_quote_item', 'purchase_order', 'purchase_order_item', 'purchase_order_dispatch',
    'maintenance_folio_counter',
  ];

  public async up(q: QueryRunner): Promise<void> {
    const [{ collation }] = await q.query('SELECT @@collation_database AS collation');
    const charset = String(collation).split('_')[0];
    for (const t of FixMaintenanceCollation1786000000076.TABLES) {
      const rows: any[] = await q.query(
        'SELECT TABLE_COLLATION AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
        [t],
      );
      if (!rows.length || rows[0].c === collation) continue;
      await q.query(`ALTER TABLE \`${t}\` CONVERT TO CHARACTER SET ${charset} COLLATE ${collation}`);
    }
  }

  public async down(): Promise<void> {
    // Sin reversa: volver a unicode_ci reintroduciría el error de JOIN.
  }
}

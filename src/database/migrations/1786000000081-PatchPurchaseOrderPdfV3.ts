import { MigrationInterface, QueryRunner } from 'typeorm';
import { PURCHASE_ORDER_PDF_HTML } from '../../documents/seeds/templates/purchase-order.pdf.html';

/**
 * Compras v3: la plantilla `purchase_order_pdf` ahora lleva impuestos por partida (columna "Impuestos"),
 * renglón de IEPS y tarjeta "Solicitud" cuando la compra no es para una unidad.
 *
 * `seedPdfTemplates` solo inserta la versión 1 si falta, así que se reescribe el HTML de las versiones
 * sembradas (changelog "Seed…"); las editadas a mano no se tocan. Las plantillas nuevas
 * (`request_quote_pdf`, `purchase_comparison_pdf`) las crea el seeder al arrancar.
 */
export class PatchPurchaseOrderPdfV31786000000081 implements MigrationInterface {
  name = 'PatchPurchaseOrderPdfV31786000000081';

  public async up(q: QueryRunner): Promise<void> {
    const rows: { id: string; designJson: any }[] = await q.query(
      `SELECT v.id AS id, v.designJson AS designJson
         FROM document_template_version v
         JOIN document_template t ON t.id = v.templateId
        WHERE t.code = 'purchase_order_pdf' AND v.changelog LIKE 'Seed%'`,
    );
    for (const row of rows) {
      const doc = typeof row.designJson === 'string' ? JSON.parse(row.designJson) : row.designJson;
      if (!doc || typeof doc.html !== 'string' || doc.html === PURCHASE_ORDER_PDF_HTML) continue;
      doc.html = PURCHASE_ORDER_PDF_HTML;
      await q.query('UPDATE document_template_version SET designJson = ? WHERE id = ?', [JSON.stringify(doc), row.id]);
    }
  }

  public async down(): Promise<void> {
    // Sin reversa: el HTML anterior no incluía IEPS; se conserva el nuevo.
  }
}

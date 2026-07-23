import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Hace dinámica la etiqueta de la celda de sucursal en la plantilla
 * `warehouse_dispatch_pdf`: 'SUCURSAL' → '{{subsidiaryLabel}}'. Así el traspaso
 * puede mostrar "SUCURSAL DESTINO" (con el destino) mientras salida a ruta /
 * entrada siguen mostrando "SUCURSAL".
 *
 * Necesaria porque `seedPdfTemplates` sólo INSERTA la versión 1 si falta; no
 * actualiza el `designJson` de plantillas ya sembradas. Parcheamos el JSON in
 * situ (idempotente) en las versiones existentes de esta plantilla.
 */
export class PatchWarehousePdfSucursalLabel1786000000037 implements MigrationInterface {
  name = 'PatchWarehousePdfSucursalLabel1786000000037'

  private async patch(queryRunner: QueryRunner, from: string, to: string): Promise<void> {
    const rows: { id: string; designJson: any }[] = await queryRunner.query(
      `SELECT v.id AS id, v.designJson AS designJson
         FROM document_template_version v
         JOIN document_template t ON t.id = v.templateId
        WHERE t.code = 'warehouse_dispatch_pdf'`,
    );
    for (const row of rows) {
      const doc = typeof row.designJson === 'string' ? JSON.parse(row.designJson) : row.designJson;
      if (!doc || !Array.isArray(doc.blocks)) continue;
      let changed = false;
      for (const block of doc.blocks) {
        if (block?.type === 'infoGrid' && Array.isArray(block.cells)) {
          for (const cell of block.cells) {
            if (cell?.label === from) {
              cell.label = to;
              changed = true;
            }
          }
        }
      }
      if (changed) {
        await queryRunner.query(
          `UPDATE document_template_version SET designJson = ? WHERE id = ?`,
          [JSON.stringify(doc), row.id],
        );
      }
    }
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.patch(queryRunner, 'SUCURSAL', '{{subsidiaryLabel}}');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.patch(queryRunner, '{{subsidiaryLabel}}', 'SUCURSAL');
  }
}

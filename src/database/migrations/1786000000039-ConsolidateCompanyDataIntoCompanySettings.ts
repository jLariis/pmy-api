import { MigrationInterface, QueryRunner } from 'typeorm';
import { randomUUID } from 'crypto';

/**
 * Consolida los DATOS DE EMPRESA en `company_settings` (fuente única) y elimina la
 * duplicación que vivía en `brand.fiscal` / `brand.contact`.
 *
 *  1. Respalda: si `company_settings` tiene un campo vacío y `brand` traía el dato en
 *     su JSON fiscal/contact, lo copia (no pisa datos ya capturados en company_settings).
 *  2. Elimina las columnas `fiscal` y `contact` de `brand` (ya no se usan; `brand` se
 *     queda solo con identidad visual: logos, colores, tipografía, redes).
 *
 * Idempotente: si las columnas ya no existen, no hace nada. El respaldo solo rellena
 * huecos, nunca sobreescribe.
 */
export class ConsolidateCompanyDataIntoCompanySettings1786000000039 implements MigrationInterface {
  name = 'ConsolidateCompanyDataIntoCompanySettings1786000000039';

  private async hasColumn(q: QueryRunner, table: string, column: string): Promise<boolean> {
    const rows: any[] = await q.query(
      `SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column],
    );
    return (rows?.length ?? 0) > 0;
  }

  public async up(q: QueryRunner): Promise<void> {
    const hasFiscal = await this.hasColumn(q, 'brand', 'fiscal');
    const hasContact = await this.hasColumn(q, 'brand', 'contact');

    // --- 1. Respaldo brand.fiscal/contact → company_settings (solo rellena huecos) ---
    if (hasFiscal || hasContact) {
      const cols = [hasFiscal ? 'fiscal' : null, hasContact ? 'contact' : null].filter(Boolean).join(', ');
      const brandRows: any[] = await q.query(
        `SELECT ${cols} FROM \`brand\` WHERE \`key\` = 'default' LIMIT 1`,
      );
      const brand = brandRows?.[0] ?? {};
      const parse = (v: any) => {
        if (!v) return {};
        if (typeof v === 'object') return v;
        try { return JSON.parse(v); } catch { return {}; }
      };
      const fiscal = parse(brand.fiscal);
      const contact = parse(brand.contact);

      // Mapeo campo brand → columna company_settings.
      const mapped: Record<string, string> = {
        name: fiscal.razonSocial,
        taxId: fiscal.rfc,
        address: fiscal.direccion,
        phone: contact.phone,
        email: contact.email,
        website: contact.website,
      };

      // Singleton: toma la fila existente o crea una vacía.
      let csRows: any[] = await q.query(`SELECT * FROM \`company_settings\` ORDER BY \`id\` ASC LIMIT 1`);
      if (!csRows?.length) {
        await q.query(`INSERT INTO \`company_settings\` (\`id\`) VALUES (?)`, [randomUUID()]);
        csRows = await q.query(`SELECT * FROM \`company_settings\` ORDER BY \`id\` ASC LIMIT 1`);
      }
      const cs = csRows[0];

      const updates: string[] = [];
      const params: any[] = [];
      for (const [col, val] of Object.entries(mapped)) {
        const current = cs[col];
        const isEmpty = current === null || current === undefined || String(current).trim() === '';
        if (isEmpty && val && String(val).trim() !== '') {
          updates.push(`\`${col}\` = ?`);
          params.push(val);
        }
      }
      if (updates.length) {
        updates.push('`updatedAt` = ?');
        params.push(new Date());
        params.push(cs.id);
        await q.query(`UPDATE \`company_settings\` SET ${updates.join(', ')} WHERE \`id\` = ?`, params);
      }
    }

    // --- 2. Eliminar columnas duplicadas de brand ---
    if (hasFiscal) await q.query('ALTER TABLE `brand` DROP COLUMN `fiscal`');
    if (hasContact) await q.query('ALTER TABLE `brand` DROP COLUMN `contact`');
  }

  public async down(q: QueryRunner): Promise<void> {
    // Recrea las columnas (vacías). No re-duplica los datos: la fuente sigue siendo
    // company_settings; esto es solo para poder revertir el esquema.
    if (!(await this.hasColumn(q, 'brand', 'fiscal'))) {
      await q.query('ALTER TABLE `brand` ADD COLUMN `fiscal` json NULL');
    }
    if (!(await this.hasColumn(q, 'brand', 'contact'))) {
      await q.query('ALTER TABLE `brand` ADD COLUMN `contact` json NULL');
    }
  }
}

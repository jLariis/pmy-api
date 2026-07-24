import { MigrationInterface, QueryRunner } from 'typeorm';
import { randomUUID } from 'crypto';
import { CATALOG_DEFS, deriveItems } from '../../catalog/catalog-definition';

/**
 * Estatus DHL (primer carrier del modelo genérico).
 *
 *  1. Agrega el valor canónico `cambio_domicilio` al enum de `shipment.status` y
 *     `shipment_status.status`. IMPORTANTE: se agrega AL FINAL de la lista → en MySQL
 *     es un cambio de SOLO METADATOS (instantáneo, NO reescribe la tabla), aunque tenga
 *     millones de registros. Se lee la definición actual desde information_schema y solo
 *     se le concatena el valor nuevo, preservando el orden/valores existentes.
 *  2. Siembra el catálogo `dhl_status` (OK/NH/BA/RD/CM) en `catalog_item`.
 *
 * Idempotente: si el valor de enum ya existe o el catálogo ya está sembrado, no hace nada.
 */
export class AddDhlStatusCatalog1786000000038 implements MigrationInterface {
  name = 'AddDhlStatusCatalog1786000000038';

  private readonly NEW_VALUE = 'cambio_domicilio';
  private readonly ENUM_COLUMNS: { table: string; column: string }[] = [
    { table: 'shipment', column: 'status' },
    { table: 'shipment_status', column: 'status' },
  ];

  public async up(q: QueryRunner): Promise<void> {
    // --- 1. Agregar `cambio_domicilio` al final de cada enum (solo metadatos) ---
    for (const { table, column } of this.ENUM_COLUMNS) {
      const rows: any[] = await q.query(
        `SELECT COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS def
           FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [table, column],
      );
      const col = rows?.[0];
      if (!col || !/^enum\(/i.test(col.type)) continue;               // no existe / no es enum
      if (col.type.includes(`'${this.NEW_VALUE}'`)) continue;         // ya presente → idempotente

      // Concatena el valor nuevo justo antes del paréntesis de cierre → queda AL FINAL.
      const newType = col.type.replace(/\)\s*$/, `,'${this.NEW_VALUE}')`);
      const nullSql = col.nullable === 'NO' ? 'NOT NULL' : 'NULL';
      const defSql = col.def === null || col.def === undefined ? '' : `DEFAULT '${col.def}'`;

      await q.query(
        `ALTER TABLE \`${table}\` MODIFY COLUMN \`${column}\` ${newType} ${nullSql} ${defSql}`.trim(),
      );
    }

    // --- 2. Sembrar catálogo dhl_status ---
    const def = CATALOG_DEFS.find((d) => d.type === 'dhl_status');
    if (def) {
      const count: any[] = await q.query(
        `SELECT COUNT(*) AS c FROM \`catalog_item\` WHERE \`type\` = ?`,
        [def.type],
      );
      if (Number(count?.[0]?.c ?? 0) === 0) {
        for (const it of deriveItems(def)) {
          await q.query(
            `INSERT INTO \`catalog_item\` (\`id\`, \`type\`, \`key\`, \`label\`, \`sortOrder\`, \`active\`, \`isSystem\`) VALUES (?, ?, ?, ?, ?, 1, 1)`,
            [randomUUID(), it.type, it.key, it.label, it.sortOrder],
          );
        }
      }
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    // Quitar los items del catálogo dhl_status.
    await q.query(`DELETE FROM \`catalog_item\` WHERE \`type\` = 'dhl_status'`);

    // Revertir el enum solo si NINGÚN registro usa el valor nuevo (evita corromper datos).
    for (const { table, column } of this.ENUM_COLUMNS) {
      const used: any[] = await q.query(
        `SELECT COUNT(*) AS c FROM \`${table}\` WHERE \`${column}\` = ?`,
        [this.NEW_VALUE],
      );
      if (Number(used?.[0]?.c ?? 0) > 0) continue; // en uso → no tocar

      const rows: any[] = await q.query(
        `SELECT COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS def
           FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [table, column],
      );
      const col = rows?.[0];
      if (!col || !col.type.includes(`'${this.NEW_VALUE}'`)) continue;

      const newType = col.type
        .replace(new RegExp(`,'${this.NEW_VALUE}'`), '')
        .replace(new RegExp(`'${this.NEW_VALUE}',`), '');
      const nullSql = col.nullable === 'NO' ? 'NOT NULL' : 'NULL';
      const defSql = col.def === null || col.def === undefined ? '' : `DEFAULT '${col.def}'`;

      await q.query(
        `ALTER TABLE \`${table}\` MODIFY COLUMN \`${column}\` ${newType} ${nullSql} ${defSql}`.trim(),
      );
    }
  }
}

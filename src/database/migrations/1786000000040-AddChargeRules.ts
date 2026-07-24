import { MigrationInterface, QueryRunner } from 'typeorm';
import { randomUUID } from 'crypto';

/**
 * Modelo UNIFICADO de cobro por (carrier, código de estatus): tabla `charge_rule`.
 * Reemplaza (funcionalmente) a las columnas fijas de FedEx en `subsidiary`
 * (chargeDex03/07/08, chargeDelivered) y extiende el mismo modelo a DHL.
 *
 * Siembra preservando EXACTAMENTE el comportamiento actual:
 *   - Defaults GLOBALES = DEFAULT_INCOME_RULES (DEX03 fuera; 07/08/entregado cuentan).
 *   - Por SUCURSAL: se crea un override SOLO donde su flag difiere del default global.
 * Así los totales del dashboard y la tabla de ingresos NO cambian tras migrar.
 *
 * Las columnas viejas de `subsidiary` se conservan (no se borran) para permitir
 * rollback; los lectores ya no las usan.
 *
 * Idempotente: si la tabla ya tiene filas, no re-siembra.
 */
export class AddChargeRules1786000000040 implements MigrationInterface {
  name = 'AddChargeRules1786000000040';

  private async tableExists(q: QueryRunner, table: string): Promise<boolean> {
    const rows: any[] = await q.query(
      `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [table],
    );
    return (rows?.length ?? 0) > 0;
  }

  private async insert(q: QueryRunner, carrier: string, code: string, chargeable: boolean, subsidiaryId: string | null) {
    await q.query(
      `INSERT INTO \`charge_rule\` (\`id\`, \`carrier\`, \`code\`, \`chargeable\`, \`subsidiaryId\`) VALUES (?, ?, ?, ?, ?)`,
      [randomUUID(), carrier, code, chargeable ? 1 : 0, subsidiaryId],
    );
  }

  public async up(q: QueryRunner): Promise<void> {
    // --- 1. Crear tabla ---
    if (!(await this.tableExists(q, 'charge_rule'))) {
      await q.query(`
        CREATE TABLE \`charge_rule\` (
          \`id\` char(36) NOT NULL,
          \`carrier\` varchar(255) NOT NULL,
          \`code\` varchar(255) NOT NULL,
          \`chargeable\` tinyint NOT NULL DEFAULT 1,
          \`subsidiaryId\` char(36) NULL,
          \`updatedAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (\`id\`),
          UNIQUE KEY \`UQ_charge_rule_carrier_code_sub\` (\`carrier\`, \`code\`, \`subsidiaryId\`),
          KEY \`IDX_charge_rule_carrier\` (\`carrier\`),
          KEY \`IDX_charge_rule_sub\` (\`subsidiaryId\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    }

    // --- 2. ¿Ya sembrado? (idempotente) ---
    const count: any[] = await q.query(`SELECT COUNT(*) AS c FROM \`charge_rule\``);
    if (Number(count?.[0]?.c ?? 0) > 0) return;

    // --- 3. Defaults GLOBALES (= DEFAULT_INCOME_RULES + regla DHL "solo OK cobra") ---
    const DEF = { delivered: true, dex03: false, dex07: true, dex08: true };
    await this.insert(q, 'fedex', 'DELIVERED', DEF.delivered, null);
    await this.insert(q, 'fedex', '03', DEF.dex03, null);
    await this.insert(q, 'fedex', '07', DEF.dex07, null);
    await this.insert(q, 'fedex', '08', DEF.dex08, null);
    await this.insert(q, 'dhl', 'DELIVERED', true, null);
    // DHL no-entrega: hoy NO cobran (solo OK). Visibles/editables desde Configuración.
    for (const code of ['NH', 'BA', 'RD', 'CM']) await this.insert(q, 'dhl', code, false, null);

    // --- 4. Overrides por SUCURSAL (solo donde el flag difiere del default global) ---
    const subs: any[] = await q.query(
      `SELECT \`id\`, \`chargeDelivered\`, \`chargeDex03\`, \`chargeDex07\`, \`chargeDex08\` FROM \`subsidiary\``,
    );
    const bool = (v: any) => v === 1 || v === true || v === '1' || (Buffer.isBuffer(v) && v[0] === 1);
    for (const s of subs) {
      const delivered = bool(s.chargeDelivered);
      const dex03 = bool(s.chargeDex03);
      const dex07 = bool(s.chargeDex07);
      const dex08 = bool(s.chargeDex08);

      if (delivered !== DEF.delivered) {
        // chargeDelivered gobierna entregado de AMBOS carriers.
        await this.insert(q, 'fedex', 'DELIVERED', delivered, s.id);
        await this.insert(q, 'dhl', 'DELIVERED', delivered, s.id);
      }
      if (dex03 !== DEF.dex03) await this.insert(q, 'fedex', '03', dex03, s.id);
      if (dex07 !== DEF.dex07) await this.insert(q, 'fedex', '07', dex07, s.id);
      if (dex08 !== DEF.dex08) await this.insert(q, 'fedex', '08', dex08, s.id);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    if (await this.tableExists(q, 'charge_rule')) {
      await q.query('DROP TABLE `charge_rule`');
    }
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reglas de INGRESO por sucursal. Defaults = comportamiento histórico, así nada
 * cambia hasta que se activen por sucursal:
 *  - chargeDex03 = 0  (DEX03 no cuenta; el registro se conserva para cobrarlo luego)
 *  - chargeDex07 = 1, chargeDex08 = 1, chargeDelivered = 1
 *  - generateDhlIncomeOnDelivery = 1 (generar ingreso DHL al detectar entrega)
 *  - countTransfersAsIncome = 1 (traslados cuentan como ingreso)
 */
export class AddSubsidiaryIncomeRules1786000000014 implements MigrationInterface {
  name = 'AddSubsidiaryIncomeRules1786000000014';

  private readonly cols: { name: string; def: number }[] = [
    { name: 'chargeDex03', def: 0 },
    { name: 'chargeDex07', def: 1 },
    { name: 'chargeDex08', def: 1 },
    { name: 'chargeDelivered', def: 1 },
    { name: 'generateDhlIncomeOnDelivery', def: 1 },
    { name: 'countTransfersAsIncome', def: 1 },
  ];

  public async up(q: QueryRunner): Promise<void> {
    for (const c of this.cols) {
      const exists: any[] = await q.query(`SHOW COLUMNS FROM \`subsidiary\` LIKE '${c.name}'`);
      if (exists.length === 0) {
        await q.query(`ALTER TABLE \`subsidiary\` ADD COLUMN \`${c.name}\` TINYINT(1) NOT NULL DEFAULT ${c.def}`);
      }
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const c of this.cols) {
      const exists: any[] = await q.query(`SHOW COLUMNS FROM \`subsidiary\` LIKE '${c.name}'`);
      if (exists.length > 0) await q.query(`ALTER TABLE \`subsidiary\` DROP COLUMN \`${c.name}\``);
    }
  }
}

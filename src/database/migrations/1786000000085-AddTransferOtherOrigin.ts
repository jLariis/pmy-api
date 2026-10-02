import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Traslados: el origen ahora puede ser una sucursal externa (texto libre), igual que el destino.
 * En ese caso no hay `originId` y el ingreso se registra en la sucursal DESTINO.
 */
export class AddTransferOtherOrigin1786000000085 implements MigrationInterface {
  name = 'AddTransferOtherOrigin1786000000085';

  public async up(q: QueryRunner): Promise<void> {
    const has = await q.hasColumn('transfer', 'otherOrigin');
    if (!has) {
      await q.query(`ALTER TABLE \`transfer\` ADD \`otherOrigin\` varchar(255) NULL AFTER \`originId\``);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    const has = await q.hasColumn('transfer', 'otherOrigin');
    if (has) await q.query(`ALTER TABLE \`transfer\` DROP COLUMN \`otherOrigin\``);
  }
}

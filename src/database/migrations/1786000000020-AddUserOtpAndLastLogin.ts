import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Columnas para la recuperación de contraseña por OTP (autoservicio) y el último
 * inicio de sesión: `otpCode`, `otpExpiresAt`, `lastLoginAt` en `user`.
 */
export class AddUserOtpAndLastLogin1786000000020 implements MigrationInterface {
  name = 'AddUserOtpAndLastLogin1786000000020';

  private readonly columns: { name: string; ddl: string }[] = [
    { name: 'otpCode', ddl: 'ADD COLUMN `otpCode` varchar(255) NULL' },
    { name: 'otpExpiresAt', ddl: 'ADD COLUMN `otpExpiresAt` datetime NULL' },
    { name: 'lastLoginAt', ddl: 'ADD COLUMN `lastLoginAt` datetime NULL' },
  ];

  public async up(q: QueryRunner): Promise<void> {
    for (const col of this.columns) {
      await q.query(`ALTER TABLE \`user\` ${col.ddl}`).catch((e: any) => {
        if (/Duplicate column name|already exists/i.test(e?.message || '')) return undefined;
        throw e;
      });
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const col of ['otpCode', 'otpExpiresAt', 'lastLoginAt']) {
      await q.query(`ALTER TABLE \`user\` DROP COLUMN \`${col}\``).catch(() => undefined);
    }
  }
}

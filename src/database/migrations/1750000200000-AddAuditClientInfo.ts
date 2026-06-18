import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAuditClientInfo1750000200000 implements MigrationInterface {
  name = 'AddAuditClientInfo1750000200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`audit_log\`
        ADD COLUMN \`publicIp\`   VARCHAR(64)  NULL,
        ADD COLUMN \`geoCity\`    VARCHAR(120) NULL,
        ADD COLUMN \`geoRegion\`  VARCHAR(120) NULL,
        ADD COLUMN \`geoCountry\` VARCHAR(120) NULL,
        ADD COLUMN \`device\`     VARCHAR(160) NULL,
        ADD COLUMN \`deviceId\`   VARCHAR(64)  NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`audit_log\`
        DROP COLUMN \`publicIp\`,
        DROP COLUMN \`geoCity\`,
        DROP COLUMN \`geoRegion\`,
        DROP COLUMN \`geoCountry\`,
        DROP COLUMN \`device\`,
        DROP COLUMN \`deviceId\`;
    `);
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateNotificationRead1750000100000 implements MigrationInterface {
  name = 'CreateNotificationRead1750000100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`notification_read\` (
        \`userId\`     VARCHAR(36) NOT NULL,
        \`lastReadAt\` DATETIME    NULL,
        PRIMARY KEY (\`userId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS \`notification_read\`;`);
  }
}

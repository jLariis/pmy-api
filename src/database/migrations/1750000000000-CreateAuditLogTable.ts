import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuditLogTable1750000000000 implements MigrationInterface {
  name = 'CreateAuditLogTable1750000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`audit_log\` (
        \`id\`            VARCHAR(36)   NOT NULL,
        \`userId\`        VARCHAR(36)   NULL,
        \`userEmail\`     VARCHAR(255)  NULL,
        \`userName\`      VARCHAR(255)  NULL,
        \`role\`          VARCHAR(255)  NULL,
        \`module\`        VARCHAR(50)   NOT NULL,
        \`action\`        VARCHAR(50)   NOT NULL,
        \`result\`        VARCHAR(20)   NOT NULL DEFAULT 'success',
        \`severity\`      VARCHAR(20)   NOT NULL DEFAULT 'info',
        \`entityName\`    VARCHAR(100)  NULL,
        \`entityId\`      VARCHAR(100)  NULL,
        \`description\`   VARCHAR(500)  NULL,
        \`beforeState\`   JSON          NULL,
        \`afterState\`    JSON          NULL,
        \`changes\`       JSON          NULL,
        \`metadata\`      JSON          NULL,
        \`method\`        VARCHAR(10)   NULL,
        \`path\`          VARCHAR(255)  NULL,
        \`statusCode\`    INT           NULL,
        \`errorMessage\`  VARCHAR(1000) NULL,
        \`ip\`            VARCHAR(64)   NULL,
        \`userAgent\`     VARCHAR(512)  NULL,
        \`subsidiaryId\`  VARCHAR(36)   NULL,
        \`requestId\`     VARCHAR(64)   NULL,
        \`durationMs\`    INT           NULL,
        \`createdAt\`     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        KEY \`idx_audit_user\`        (\`userId\`),
        KEY \`idx_audit_module\`      (\`module\`),
        KEY \`idx_audit_action\`      (\`action\`),
        KEY \`idx_audit_result\`      (\`result\`),
        KEY \`idx_audit_created\`     (\`createdAt\`),
        KEY \`idx_audit_subsidiary\`  (\`subsidiaryId\`),
        KEY \`idx_audit_entity\`      (\`entityName\`, \`entityId\`),
        KEY \`idx_audit_user_date\`   (\`userId\`, \`createdAt\`),
        KEY \`idx_audit_module_date\` (\`module\`, \`createdAt\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS \`audit_log\`;`);
  }
}

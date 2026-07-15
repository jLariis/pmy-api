import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tablas del motor de plantillas. `id` uuid materializa como VARCHAR(36).
 * templateId es FK real → document_template.id: VARCHAR(36) COLLATE utf8mb4_unicode_ci.
 */
export class CreateDocumentTemplates1786000000033 implements MigrationInterface {
  name = 'CreateDocumentTemplates1786000000033';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS \`brand\` (
        \`id\`           VARCHAR(36)  NOT NULL,
        \`key\`          VARCHAR(40)  NOT NULL DEFAULT 'default',
        \`logoLight\`    VARCHAR(500) NULL,
        \`logoDark\`     VARCHAR(500) NULL,
        \`colors\`       JSON         NULL,
        \`typography\`   JSON         NULL,
        \`borderRadius\` VARCHAR(20)  NULL,
        \`spacing\`      JSON         NULL,
        \`fiscal\`       JSON         NULL,
        \`contact\`      JSON         NULL,
        \`social\`       JSON         NULL,
        \`tenantId\`     CHAR(36)     NULL,
        \`updatedAt\`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_brand_key\` (\`key\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await q.query(`
      CREATE TABLE IF NOT EXISTS \`document_template\` (
        \`id\`               VARCHAR(36)  NOT NULL,
        \`code\`             VARCHAR(80)  NOT NULL,
        \`name\`             VARCHAR(160) NOT NULL,
        \`type\`             VARCHAR(20)  NOT NULL,
        \`description\`      VARCHAR(300) NULL,
        \`language\`         VARCHAR(8)   NOT NULL DEFAULT 'es',
        \`active\`           TINYINT(1)   NOT NULL DEFAULT 1,
        \`category\`         VARCHAR(60)  NULL,
        \`currentVersionId\` CHAR(36)     NULL,
        \`tenantId\`         CHAR(36)     NULL,
        \`createdAt\`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_document_template_code_lang\` (\`code\`, \`language\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await q.query(`
      CREATE TABLE IF NOT EXISTS \`document_template_version\` (
        \`id\`            VARCHAR(36)  NOT NULL,
        \`templateId\`    VARCHAR(36)  NOT NULL COLLATE utf8mb4_unicode_ci,
        \`version\`       INT          NOT NULL,
        \`status\`        VARCHAR(20)  NOT NULL DEFAULT 'draft',
        \`subject\`       VARCHAR(300) NULL,
        \`designJson\`    JSON         NULL,
        \`compiledBody\`  LONGTEXT     NULL,
        \`engine\`        VARCHAR(20)  NOT NULL DEFAULT 'handlebars',
        \`changelog\`     VARCHAR(500) NULL,
        \`createdById\`   CHAR(36)     NULL,
        \`createdByName\` VARCHAR(160) NULL,
        \`createdAt\`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`publishedAt\`   DATETIME     NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_dtv_template_version\` (\`templateId\`, \`version\`),
        CONSTRAINT \`fk_dtv_template\` FOREIGN KEY (\`templateId\`)
          REFERENCES \`document_template\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await q.query(`
      CREATE TABLE IF NOT EXISTS \`template_variable_def\` (
        \`id\`         VARCHAR(36)  NOT NULL,
        \`templateId\` VARCHAR(36)  NOT NULL COLLATE utf8mb4_unicode_ci,
        \`name\`       VARCHAR(80)  NOT NULL,
        \`label\`      VARCHAR(160) NOT NULL,
        \`dataType\`   VARCHAR(20)  NOT NULL DEFAULT 'string',
        \`example\`    VARCHAR(300) NULL,
        \`required\`   TINYINT(1)   NOT NULL DEFAULT 0,
        PRIMARY KEY (\`id\`),
        KEY \`idx_tvd_template\` (\`templateId\`),
        CONSTRAINT \`fk_tvd_template\` FOREIGN KEY (\`templateId\`)
          REFERENCES \`document_template\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await q.query(`
      CREATE TABLE IF NOT EXISTS \`template_render_log\` (
        \`id\`        VARCHAR(36) NOT NULL,
        \`code\`      VARCHAR(80) NOT NULL,
        \`version\`   INT         NOT NULL DEFAULT 0,
        \`format\`    VARCHAR(20) NOT NULL,
        \`status\`    VARCHAR(20) NOT NULL,
        \`entityId\`  VARCHAR(64) NULL,
        \`ms\`        INT         NULL,
        \`error\`     TEXT        NULL,
        \`createdAt\` DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        KEY \`idx_trl_code_created\` (\`code\`, \`createdAt\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE IF EXISTS `template_render_log`');
    await q.query('DROP TABLE IF EXISTS `template_variable_def`');
    await q.query('DROP TABLE IF EXISTS `document_template_version`');
    await q.query('DROP TABLE IF EXISTS `document_template`');
    await q.query('DROP TABLE IF EXISTS `brand`');
  }
}

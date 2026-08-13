import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Soporte: adjuntos (imágenes) por comentario. Tabla espejo de
 * `support_ticket_attachment` pero referida a `support_ticket_comment`.
 * Los archivos viven en disco; aquí solo la metadata + URL servida. Idempotente.
 */
export class AddSupportCommentAttachments1786000000045 implements MigrationInterface {
  name = 'AddSupportCommentAttachments1786000000045';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS \`support_ticket_comment_attachment\` (
        \`id\` char(36) NOT NULL,
        \`commentId\` varchar(36) NOT NULL,
        \`filename\` varchar(260) NOT NULL,
        \`url\` varchar(400) NOT NULL,
        \`mime\` varchar(100) NULL,
        \`size\` int NULL,
        \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        KEY \`IDX_support_comment_attachment_commentId\` (\`commentId\`),
        CONSTRAINT \`FK_support_comment_attachment_comment\`
          FOREIGN KEY (\`commentId\`) REFERENCES \`support_ticket_comment\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS \`support_ticket_comment_attachment\``);
  }
}

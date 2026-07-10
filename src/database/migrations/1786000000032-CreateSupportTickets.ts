import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tablas del subsistema de "Support Tickets" (mesa de ayuda in-app):
 * `support_ticket` (una fila por ticket), `support_ticket_comment` y
 * `support_ticket_attachment` (hijas, con FK CASCADE a support_ticket.id).
 * Columnas espejo de src/entities/support-ticket{,-comment,-attachment}.entity.ts.
 *
 * Nota de tipos: `id` de las 3 tablas es @PrimaryGeneratedColumn('uuid'), que en
 * este proyecto TypeORM/mysql materializa como VARCHAR(36) (ver todas las
 * migraciones previas, p.ej. 1786000000031-CreateNotification.ts) — NO CHAR(36).
 *
 * Alineación de FK: las columnas `ticketId` están declaradas en las entidades hijas
 * como @Column({ type: 'char', length: 36 }), pero son la columna de FK real hacia
 * `support_ticket.id` (VARCHAR(36)). InnoDB exige que columna FK y PK referenciada
 * tengan tipo+collation compatibles (mismatch CHAR/VARCHAR + collation distinta
 * puede fallar o comportarse raro, como notó 1786000000030-ExpenseCategoriesRedesign.ts
 * al alinear `expense.categoryId` con `expense_category.id`). Como las 3 tablas se
 * crean aquí mismo con el mismo CHARSET/COLLATE, en vez de "detectar" un collation
 * externo (no aplica, son tablas nuevas) simplemente declaramos `ticketId` como
 * VARCHAR(36) COLLATE utf8mb4_unicode_ci — idéntico a `support_ticket.id` — para que
 * la FK se cree limpia. El resto de columnas *_Id que NO son FK reales (requesterId,
 * assigneeId, subsidiaryId, authorId: solo referencian ids de `user`/`subsidiary` sin
 * constraint) se dejan como CHAR(36), tal cual las entidades.
 */
export class CreateSupportTickets1786000000032 implements MigrationInterface {
  name = 'CreateSupportTickets1786000000032';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS \`support_ticket\` (
        \`id\`             VARCHAR(36)  NOT NULL,
        \`folio\`          VARCHAR(20)  NOT NULL,
        \`tipo\`           VARCHAR(20)  NOT NULL,
        \`titulo\`         VARCHAR(200) NOT NULL,
        \`descripcion\`    TEXT         NOT NULL,
        \`estado\`         VARCHAR(20)  NOT NULL DEFAULT 'pendiente',
        \`prioridad\`      VARCHAR(20)  NOT NULL DEFAULT 'media',
        \`menuPrincipal\`  VARCHAR(60)  NULL,
        \`submenu\`        VARCHAR(60)  NULL,
        \`seccion\`        VARCHAR(60)  NULL,
        \`subseccion\`     VARCHAR(60)  NULL,
        \`nuevoMenu\`      VARCHAR(120) NULL,
        \`menuError\`      VARCHAR(60)  NULL,
        \`submenuError\`   VARCHAR(60)  NULL,
        \`pasosReplicar\`  TEXT         NULL,
        \`requesterId\`    CHAR(36)     NOT NULL,
        \`requesterName\`  VARCHAR(160) NULL,
        \`requesterEmail\` VARCHAR(160) NULL,
        \`subsidiaryId\`   CHAR(36)     NULL,
        \`assigneeId\`     CHAR(36)     NULL,
        \`assigneeName\`   VARCHAR(160) NULL,
        \`appVersion\`     VARCHAR(60)  NULL,
        \`route\`          VARCHAR(300) NULL,
        \`userAgent\`      VARCHAR(300) NULL,
        \`createdAt\`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\`      DATETIME     NULL,
        \`resolvedAt\`     DATETIME     NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_support_ticket_folio\` (\`folio\`),
        KEY \`idx_support_ticket_estado\` (\`estado\`),
        KEY \`idx_support_ticket_requesterId\` (\`requesterId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await q.query(`
      CREATE TABLE IF NOT EXISTS \`support_ticket_comment\` (
        \`id\`         VARCHAR(36)  NOT NULL,
        \`ticketId\`   VARCHAR(36)  NOT NULL,
        \`authorId\`   CHAR(36)     NULL,
        \`authorName\` VARCHAR(160) NULL,
        \`texto\`      TEXT         NOT NULL,
        \`internal\`   TINYINT(1)   NOT NULL DEFAULT 0,
        \`createdAt\`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        KEY \`idx_support_ticket_comment_ticketId\` (\`ticketId\`),
        CONSTRAINT \`fk_support_ticket_comment_ticket\` FOREIGN KEY (\`ticketId\`)
          REFERENCES \`support_ticket\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await q.query(`
      CREATE TABLE IF NOT EXISTS \`support_ticket_attachment\` (
        \`id\`        VARCHAR(36)  NOT NULL,
        \`ticketId\`  VARCHAR(36)  NOT NULL,
        \`filename\`  VARCHAR(260) NOT NULL,
        \`url\`       VARCHAR(400) NOT NULL,
        \`mime\`      VARCHAR(100) NULL,
        \`size\`      INT          NULL,
        \`createdAt\` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        KEY \`idx_support_ticket_attachment_ticketId\` (\`ticketId\`),
        CONSTRAINT \`fk_support_ticket_attachment_ticket\` FOREIGN KEY (\`ticketId\`)
          REFERENCES \`support_ticket\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    // Hijas primero (tienen FK hacia support_ticket).
    await q.query('DROP TABLE IF EXISTS `support_ticket_attachment`');
    await q.query('DROP TABLE IF EXISTS `support_ticket_comment`');
    await q.query('DROP TABLE IF EXISTS `support_ticket`');
  }
}

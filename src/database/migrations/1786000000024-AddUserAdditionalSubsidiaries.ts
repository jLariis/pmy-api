import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sucursales adicionales por usuario (más allá de la "main" en `user.subsidiaryId`).
 * Tabla join M:M sin FK física (mismo criterio que `role_permissions`: la tabla
 * `user` tiene otro charset/collation y MySQL rechaza el FK por
 * ER_FK_INCOMPATIBLE_COLUMNS). Arranca vacía; no requiere backfill.
 *
 * IMPORTANTE: NO fijar `COLLATE` explícito aquí. `user.id`/`subsidiary.id` se
 * crearon sin collation explícita (heredan `utf8mb4_0900_ai_ci`, el default del
 * servidor); si esta tabla se crea con `utf8mb4_unicode_ci` (como hicieron
 * `role`/`permission`/`role_permissions`, que SÍ comparten esa collation entre
 * sí) el JOIN contra `user`/`subsidiary` revienta con
 * "Illegal mix of collations". Se deja que herede el default del servidor para
 * que coincida con `user`/`subsidiary`.
 */
export class AddUserAdditionalSubsidiaries1786000000024 implements MigrationInterface {
  name = 'AddUserAdditionalSubsidiaries1786000000024';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS \`user_subsidiary\` (
        \`userId\`       VARCHAR(36) NOT NULL,
        \`subsidiaryId\` VARCHAR(36) NOT NULL,
        PRIMARY KEY (\`userId\`, \`subsidiaryId\`),
        KEY \`idx_us_subsidiary\` (\`subsidiaryId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS \`user_subsidiary\``);
  }
}

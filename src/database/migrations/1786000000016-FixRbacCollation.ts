import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Corrige el choque de collations en RBAC. La tabla `user` es utf8mb4_0900_ai_ci
 * (default de MySQL 8, igual que el resto de lo operativo), pero las tablas RBAC
 * se crearon como utf8mb4_unicode_ci. Al unir `role.id = user.roleId` (o
 * `user_permission.userId = user.id`) MySQL lanza
 * ER_CANT_AGGREGATE_2COLLATIONS (1267).
 *
 * Solución: convertir las tablas RBAC a utf8mb4_0900_ai_ci para que coincidan con
 * `user` (no tocamos `user`, que está unido con muchas tablas operativas).
 * Las FKs de RBAC son "suaves" (sin constraint físico), así que CONVERT es seguro.
 */
export class FixRbacCollation1786000000016 implements MigrationInterface {
  name = 'FixRbacCollation1786000000016';

  private readonly tables = ['role', 'permission', 'role_permissions', 'user_permission'];

  public async up(q: QueryRunner): Promise<void> {
    for (const t of this.tables) {
      await q.query(`ALTER TABLE \`${t}\` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`).catch((e: any) => {
        // Si la tabla no existe en algún entorno, no abortamos.
        if (/doesn't exist|Unknown table/i.test(e?.message || '')) return undefined;
        throw e;
      });
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    // Revertir a unicode_ci (estado previo).
    for (const t of this.tables) {
      await q.query(`ALTER TABLE \`${t}\` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`).catch(() => undefined);
    }
  }
}

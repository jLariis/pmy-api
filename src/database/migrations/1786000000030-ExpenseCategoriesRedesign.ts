import { MigrationInterface, QueryRunner } from 'typeorm';
import { randomUUID } from 'crypto';

/**
 * expense.category (enum) -> FK a expense_category (tabla normalizada), con grupos.
 * Las 11 viejas = isSystem=true (protegen datos históricos); la lista nueva = editable.
 * Nombres verbatim (no rename). Backfill determinista por mapa identidad de las 11.
 */
export class ExpenseCategoriesRedesign1786000000030 implements MigrationInterface {
  name = 'ExpenseCategoriesRedesign1786000000030';

  public async up(q: QueryRunner): Promise<void> {
    // 0) Detectar collation real de expense.id para que la FK no choque (MySQL 1253/3780).
    const collRows = await q.query(
      "SELECT COLLATION_NAME AS c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'expense' AND COLUMN_NAME = 'id' LIMIT 1",
    );
    const collation = collRows?.[0]?.c || 'utf8mb4_0900_ai_ci';

    // 1) Tablas
    await q.query(`
      CREATE TABLE IF NOT EXISTS \`expense_category_group\` (
        \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
        \`name\` VARCHAR(255) NOT NULL,
        \`icon\` VARCHAR(16) NULL,
        \`sortOrder\` INT NOT NULL DEFAULT 0,
        \`isSystem\` TINYINT NOT NULL DEFAULT 0,
        \`active\` TINYINT NOT NULL DEFAULT 1,
        \`createdAt\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=${collation};
    `);
    await q.query(`
      CREATE TABLE IF NOT EXISTS \`expense_category\` (
        \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
        \`name\` VARCHAR(255) NOT NULL,
        \`groupId\` VARCHAR(36) NULL,
        \`isSystem\` TINYINT NOT NULL DEFAULT 0,
        \`active\` TINYINT NOT NULL DEFAULT 1,
        \`sortOrder\` INT NOT NULL DEFAULT 0,
        \`description\` VARCHAR(255) NULL,
        \`createdAt\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY \`idx_ec_group\` (\`groupId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=${collation};
    `);

    // 2) Seed grupos (isSystem=1)
    const groups: Array<{ name: string; icon: string }> = [
      { name: 'Personal y Nómina', icon: '👥' },
      { name: 'Instalaciones y Servicios', icon: '🏢' },
      { name: 'Vehículos y Operación', icon: '🚚' },
      { name: 'Viajes y Distribución', icon: '🛣️' },
      { name: 'Administrativos y Otros', icon: '📦' },
    ];
    const groupId: Record<string, string> = {};
    for (let i = 0; i < groups.length; i++) {
      const id = randomUUID();
      groupId[groups[i].name] = id;
      await q.query(
        'INSERT INTO `expense_category_group` (`id`,`name`,`icon`,`sortOrder`,`isSystem`,`active`) VALUES (?,?,?,?,1,1)',
        [id, groups[i].name, groups[i].icon, i + 1],
      );
    }

    // 3) Seed categorías. system=true para las 11 viejas (y overlaps); false para nuevas.
    //    [name, groupName, isSystem]
    const cats: Array<[string, string, number]> = [
      ['Nómina', 'Personal y Nómina', 1],
      ['Carga Social', 'Personal y Nómina', 0],
      ['Comisiones', 'Personal y Nómina', 0],
      ['Vacaciones', 'Personal y Nómina', 0],
      ['Finiquitos / Liquidaciones', 'Personal y Nómina', 0],
      ['Despensa', 'Personal y Nómina', 0],
      ['Equipo de Seguridad', 'Personal y Nómina', 0],
      ['Renta', 'Instalaciones y Servicios', 1],
      ['Renta de Oficina', 'Instalaciones y Servicios', 0],
      ['Renta de Bodega', 'Instalaciones y Servicios', 0],
      ['Renta de Local', 'Instalaciones y Servicios', 0],
      ['Renta Habitacional', 'Instalaciones y Servicios', 0],
      ['Internet', 'Instalaciones y Servicios', 0],
      ['Agua', 'Instalaciones y Servicios', 0],
      ['Luz', 'Instalaciones y Servicios', 0],
      ['Servicios', 'Instalaciones y Servicios', 1],
      ['Papelería', 'Instalaciones y Servicios', 0],
      ['Artículos de Limpieza', 'Instalaciones y Servicios', 0],
      ['Combustible', 'Vehículos y Operación', 1],
      ['Mantenimiento', 'Vehículos y Operación', 1],
      ['Mantenimiento de Bodega', 'Vehículos y Operación', 0],
      ['Póliza de Seguro', 'Vehículos y Operación', 0],
      ['Seguros', 'Vehículos y Operación', 1],
      ['Revalidación de Unidades', 'Vehículos y Operación', 0],
      ['Arrendamiento', 'Vehículos y Operación', 0],
      ['Financiamiento', 'Vehículos y Operación', 0],
      ['Permisos', 'Vehículos y Operación', 0],
      ['Permisos de Carga y Descarga', 'Vehículos y Operación', 0],
      ['Recargas LEO', 'Vehículos y Operación', 0],
      ['Recargas GPS', 'Vehículos y Operación', 0],
      ['Saldos LEO y GPS', 'Vehículos y Operación', 0],
      ['Recarga', 'Vehículos y Operación', 1],
      ['Viáticos', 'Viajes y Distribución', 1],
      ['Viáticos de Alimentación', 'Viajes y Distribución', 0],
      ['Comida Ruta Local', 'Viajes y Distribución', 0],
      ['Peajes', 'Viajes y Distribución', 1],
      ['Traslados', 'Viajes y Distribución', 0],
      ['Vuelos', 'Viajes y Distribución', 0],
      ['Apoyo Carga y Descarga', 'Viajes y Distribución', 0],
      ['Servicios de Mensajería', 'Administrativos y Otros', 0],
      ['Otros gastos', 'Administrativos y Otros', 1],
      ['Impuestos', 'Administrativos y Otros', 1],
    ];
    const catId: Record<string, string> = {};
    for (let i = 0; i < cats.length; i++) {
      const [name, gName, isSystem] = cats[i];
      const id = randomUUID();
      catId[name] = id;
      await q.query(
        'INSERT INTO `expense_category` (`id`,`name`,`groupId`,`isSystem`,`active`,`sortOrder`) VALUES (?,?,?,?,1,?)',
        [id, name, groupId[gName], isSystem, i],
      );
    }

    // 4) FK en expense
    await q.query(`ALTER TABLE \`expense\` ADD COLUMN \`categoryId\` VARCHAR(36) COLLATE ${collation} NULL`);

    // 5) Backfill: mapa identidad de las 11 (nombres verbatim)
    const legacyMap: Record<string, string> = {
      'Nómina': 'Nómina',
      'Renta': 'Renta',
      'Recarga': 'Recarga',
      'Peajes': 'Peajes',
      'Servicios': 'Servicios',
      'Combustible': 'Combustible',
      'Otros gastos': 'Otros gastos',
      'Mantenimiento': 'Mantenimiento',
      'Impuestos': 'Impuestos',
      'Seguros': 'Seguros',
      'Viáticos': 'Viáticos',
    };
    for (const legacy of Object.keys(legacyMap)) {
      const targetId = catId[legacyMap[legacy]];
      await q.query('UPDATE `expense` SET `categoryId` = ? WHERE `category` = ?', [targetId, legacy]);
    }

    // 6) Verify-gate: cero gastos con category no vacío sin mapear
    const unmapped = await q.query(
      "SELECT COUNT(*) AS c FROM `expense` WHERE `category` IS NOT NULL AND `category` <> '' AND `categoryId` IS NULL",
    );
    const c = Number(unmapped?.[0]?.c ?? 0);
    if (c > 0) {
      throw new Error(`Migración abortada: ${c} gastos con categoría legacy sin mapear. Revisar audit-expense-categories.sql.`);
    }

    // 7) FK + drop columna vieja
    await q.query('ALTER TABLE `expense` ADD CONSTRAINT `fk_expense_category` FOREIGN KEY (`categoryId`) REFERENCES `expense_category`(`id`) ON DELETE RESTRICT');
    await q.query('ALTER TABLE `expense` DROP COLUMN `category`');
  }

  public async down(q: QueryRunner): Promise<void> {
    // Reponer columna enum-equivalente como VARCHAR y rellenar desde el nombre de la categoría.
    await q.query('ALTER TABLE `expense` ADD COLUMN `category` VARCHAR(255) NULL');
    await q.query('UPDATE `expense` e JOIN `expense_category` c ON c.`id` = e.`categoryId` SET e.`category` = c.`name`');
    await q.query('ALTER TABLE `expense` DROP FOREIGN KEY `fk_expense_category`');
    await q.query('ALTER TABLE `expense` DROP COLUMN `categoryId`');
    await q.query('DROP TABLE IF EXISTS `expense_category`');
    await q.query('DROP TABLE IF EXISTS `expense_category_group`');
  }
}

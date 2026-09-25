import { MigrationInterface, QueryRunner } from 'typeorm';
import { randomUUID } from 'crypto';
import { SEED_INSUMOS, SEED_PIEZAS, SEED_PRODUCTS, SEED_UNITS } from '../seeds/compras-catalog.seed';

/**
 * Compras v3 (spec 2026-09-24-compras-v3-design):
 *  - Catálogos: `unit_of_measure`, `product_category` (pieza/insumo/servicio/equipo), `product`, `product_offer`
 *    (precio + calidad por proveedor). Semilla desde "LARIS CATALAGO.xlsx".
 *  - Solicitudes con renglones (`request_item`), tipo, revisión (Gerardo) y unidad opcional.
 *  - Ficha de piezas/insumos por unidad (`vehicle_spec_item`).
 *  - Partidas con existencia e impuestos por partida (IVA/IEPS); OC con IEPS; proveedor con banco/CLABE.
 *  - Folio de solicitud `SOL-` (antes `MT-`).
 * Los servicios del catálogo viejo (`maintenance_service`) pasan a `product` con el MISMO id (y sus categorías a
 * `product_category` kind=servicio con el mismo id), así `serviceId` → `productId` se copia tal cual.
 * Sin COLLATE explícito (hereda el de la BD; ver 076).
 */
export class ComprasV3Catalogs1786000000078 implements MigrationInterface {
  name = 'ComprasV3Catalogs1786000000078';

  private async columnExists(q: QueryRunner, table: string, column: string): Promise<boolean> {
    const r = await q.query(
      'SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
      [table, column],
    );
    return Number(r[0].c) > 0;
  }

  private async addColumn(q: QueryRunner, table: string, column: string, ddl: string) {
    if (!(await this.columnExists(q, table, column))) await q.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${ddl}`);
  }

  public async up(q: QueryRunner): Promise<void> {
    const T = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4';

    // ---------------- Catálogos ----------------
    await q.query(`CREATE TABLE IF NOT EXISTS \`unit_of_measure\` (
      \`id\` varchar(36) NOT NULL, \`name\` varchar(60) NOT NULL, \`abbreviation\` varchar(15) NULL,
      \`active\` tinyint(1) NOT NULL DEFAULT 1, \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`), UNIQUE KEY \`uq_uom_name\` (\`name\`)) ${T}`);

    await q.query(`CREATE TABLE IF NOT EXISTS \`product_category\` (
      \`id\` varchar(36) NOT NULL, \`name\` varchar(120) NOT NULL,
      \`kind\` enum('pieza','insumo','servicio','equipo') NOT NULL, \`sortOrder\` int NOT NULL DEFAULT 0,
      \`active\` tinyint(1) NOT NULL DEFAULT 1, \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`), UNIQUE KEY \`uq_pc_kind_name\` (\`kind\`, \`name\`)) ${T}`);

    await q.query(`CREATE TABLE IF NOT EXISTS \`product\` (
      \`id\` varchar(36) NOT NULL, \`name\` varchar(200) NOT NULL, \`description\` text NULL,
      \`categoryId\` varchar(36) NULL, \`brand\` varchar(100) NULL, \`partNumber\` varchar(100) NULL, \`unitId\` varchar(36) NULL,
      \`active\` tinyint(1) NOT NULL DEFAULT 1, \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updatedAt\` datetime NULL, \`deletedAt\` datetime NULL,
      PRIMARY KEY (\`id\`), KEY \`idx_product_category\` (\`categoryId\`), KEY \`idx_product_part\` (\`partNumber\`)) ${T}`);

    await q.query(`CREATE TABLE IF NOT EXISTS \`product_offer\` (
      \`id\` varchar(36) NOT NULL, \`productId\` varchar(36) NOT NULL, \`supplierId\` varchar(36) NOT NULL,
      \`unitId\` varchar(36) NULL, \`price\` decimal(12,2) NOT NULL DEFAULT 0, \`quality\` tinyint NULL,
      \`lastQuotedAt\` datetime NULL, \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP, \`updatedAt\` datetime NULL,
      PRIMARY KEY (\`id\`), KEY \`idx_po_product\` (\`productId\`), KEY \`idx_po_supplier\` (\`supplierId\`)) ${T}`);

    await q.query(`CREATE TABLE IF NOT EXISTS \`request_item\` (
      \`id\` varchar(36) NOT NULL, \`requestId\` varchar(36) NOT NULL, \`productId\` varchar(36) NULL,
      \`categoryId\` varchar(36) NULL, \`description\` varchar(300) NOT NULL, \`quantity\` decimal(10,2) NOT NULL DEFAULT 1,
      \`unitId\` varchar(36) NULL, \`notes\` text NULL, \`selectedQuoteItemId\` varchar(36) NULL, \`sortOrder\` int NOT NULL DEFAULT 0,
      PRIMARY KEY (\`id\`), KEY \`idx_ri_request\` (\`requestId\`)) ${T}`);

    await q.query(`CREATE TABLE IF NOT EXISTS \`vehicle_spec_item\` (
      \`id\` varchar(36) NOT NULL, \`vehicleId\` varchar(36) NOT NULL, \`categoryId\` varchar(36) NOT NULL,
      \`productId\` varchar(36) NULL, \`quantity\` decimal(10,2) NOT NULL DEFAULT 1, \`unitId\` varchar(36) NULL,
      \`notes\` varchar(300) NULL, \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`), KEY \`idx_vsi_vehicle\` (\`vehicleId\`)) ${T}`);

    // ---------------- Cambios a tablas existentes ----------------
    await this.addColumn(q, 'supplier', 'bankName', 'varchar(100) NULL');
    await this.addColumn(q, 'supplier', 'clabe', 'varchar(18) NULL');
    await this.addColumn(q, 'supplier', 'accountNumber', 'varchar(30) NULL');

    await this.addColumn(q, 'maintenance_request', 'type', "enum('mantenimiento','servicio','reparacion','compra') NOT NULL DEFAULT 'mantenimiento'");
    await this.addColumn(q, 'maintenance_request', 'reviewedById', 'varchar(36) NULL');
    await this.addColumn(q, 'maintenance_request', 'reviewedAt', 'datetime NULL');
    await this.addColumn(q, 'maintenance_request', 'rejectionReason', 'text NULL');
    await q.query('ALTER TABLE `maintenance_request` MODIFY `vehicleId` varchar(36) NULL');
    await q.query(`ALTER TABLE \`maintenance_request\` MODIFY \`status\`
      enum('por_revisar','rechazada','abierta','en_cotizacion','orden_generada','completada','cancelada') NOT NULL DEFAULT 'por_revisar'`);

    await this.addColumn(q, 'maintenance_quote_item', 'requestItemId', 'varchar(36) NULL');
    await this.addColumn(q, 'maintenance_quote_item', 'productId', 'varchar(36) NULL');
    await this.addColumn(q, 'maintenance_quote_item', 'availability', "enum('si','no','sobre_pedido') NOT NULL DEFAULT 'si'");
    await this.addColumn(q, 'maintenance_quote_item', 'leadTimeDays', 'int NULL');
    await this.addColumn(q, 'maintenance_quote_item', 'ivaEnabled', 'tinyint(1) NOT NULL DEFAULT 1');
    await this.addColumn(q, 'maintenance_quote_item', 'iepsEnabled', 'tinyint(1) NOT NULL DEFAULT 0');
    await this.addColumn(q, 'maintenance_quote_item', 'iepsRate', 'decimal(6,4) NOT NULL DEFAULT 0');
    await this.addColumn(q, 'maintenance_quote_item', 'quality', 'tinyint NULL');
    await this.addColumn(q, 'maintenance_quote', 'ieps', 'decimal(12,2) NOT NULL DEFAULT 0');

    await this.addColumn(q, 'purchase_order', 'ieps', 'decimal(12,2) NOT NULL DEFAULT 0');
    await this.addColumn(q, 'purchase_order_item', 'requestItemId', 'varchar(36) NULL');
    await this.addColumn(q, 'purchase_order_item', 'productId', 'varchar(36) NULL');
    await this.addColumn(q, 'purchase_order_item', 'ivaEnabled', 'tinyint(1) NOT NULL DEFAULT 1');
    await this.addColumn(q, 'purchase_order_item', 'iepsEnabled', 'tinyint(1) NOT NULL DEFAULT 0');
    await this.addColumn(q, 'purchase_order_item', 'iepsRate', 'decimal(6,4) NOT NULL DEFAULT 0');

    // ---------------- Semillas ----------------
    for (const [name, abbr] of SEED_UNITS) {
      await q.query('INSERT IGNORE INTO `unit_of_measure` (`id`, `name`, `abbreviation`) VALUES (?, ?, ?)', [randomUUID(), name, abbr]);
    }
    for (const [list, kind] of [[SEED_PIEZAS, 'pieza'], [SEED_INSUMOS, 'insumo']] as const) {
      for (let i = 0; i < list.length; i++) {
        await q.query('INSERT IGNORE INTO `product_category` (`id`, `name`, `kind`, `sortOrder`) VALUES (?, ?, ?, ?)', [randomUUID(), list[i], kind, i + 1]);
      }
    }
    // Catálogo viejo de servicios → categorías kind=servicio y productos (mismo id).
    await q.query(`INSERT IGNORE INTO \`product_category\` (\`id\`, \`name\`, \`kind\`, \`sortOrder\`, \`active\`)
      SELECT \`id\`, \`name\`, 'servicio', \`sortOrder\`, \`active\` FROM \`maintenance_service_category\``);
    const unitRows: Array<{ id: string; name: string }> = await q.query('SELECT id, name FROM `unit_of_measure`');
    const unitId = (name: string) => unitRows.find((u) => u.name.toLowerCase() === name.toLowerCase())?.id ?? null;
    const unitMap: Record<string, string | null> = { servicio: unitId('Servicio'), pieza: unitId('Pieza'), litro: unitId('Litro'), juego: unitId('Juego') };
    const services: any[] = await q.query('SELECT * FROM `maintenance_service`');
    for (const s of services) {
      await q.query(
        'INSERT IGNORE INTO `product` (`id`, `name`, `categoryId`, `unitId`, `active`, `createdAt`, `deletedAt`) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [s.id, s.name, s.categoryId, unitMap[s.unit] ?? null, s.active, s.createdAt, s.deletedAt],
      );
    }
    await q.query('UPDATE `maintenance_quote_item` SET `productId` = `serviceId` WHERE `productId` IS NULL AND `serviceId` IS NOT NULL');
    await q.query('UPDATE `maintenance_quote_item` SET `ivaEnabled` = IF(`taxRate` > 0, 1, 0)');
    await q.query('UPDATE `purchase_order_item` SET `ivaEnabled` = IF(`taxRate` > 0, 1, 0)');

    // Productos de ejemplo de la Hoja 1 (proveedores sin contacto se crean para completarse después).
    for (const p of SEED_PRODUCTS) {
      const cat: any[] = await q.query("SELECT id FROM `product_category` WHERE `name` = ? AND `kind` IN ('pieza','insumo') LIMIT 1", [p.category]);
      const exists: any[] = await q.query('SELECT id FROM `product` WHERE `name` = ? LIMIT 1', [p.name]);
      const productId = exists[0]?.id ?? randomUUID();
      if (!exists.length) {
        await q.query('INSERT INTO `product` (`id`, `name`, `categoryId`, `brand`, `unitId`) VALUES (?, ?, ?, ?, ?)',
          [productId, p.name, cat[0]?.id ?? null, p.brand, p.offers[0] ? unitId(p.offers[0].unit) : null]);
      }
      for (const o of p.offers) {
        let sup: any[] = await q.query('SELECT id FROM `supplier` WHERE UPPER(`name`) = ? AND `deletedAt` IS NULL LIMIT 1', [o.supplier]);
        if (!sup.length) {
          const sid = randomUUID();
          await q.query("INSERT INTO `supplier` (`id`, `name`, `notes`) VALUES (?, ?, 'Creado desde el catálogo inicial; completa sus contactos.')", [sid, o.supplier]);
          sup = [{ id: sid }];
        }
        const dup: any[] = await q.query('SELECT id FROM `product_offer` WHERE `productId` = ? AND `supplierId` = ? AND `unitId` <=> ? LIMIT 1',
          [productId, sup[0].id, unitId(o.unit)]);
        if (!dup.length) {
          await q.query('INSERT INTO `product_offer` (`id`, `productId`, `supplierId`, `unitId`, `price`, `quality`, `lastQuotedAt`) VALUES (?, ?, ?, ?, ?, ?, NOW())',
            [randomUUID(), productId, sup[0].id, unitId(o.unit), o.price, o.stars]);
        }
      }
    }

    // Folio de solicitud: SOL- (continúa el contador MT).
    await q.query(`INSERT IGNORE INTO \`maintenance_folio_counter\` (\`prefix\`, \`lastValue\`)
      SELECT 'SOL', COALESCE((SELECT \`lastValue\` FROM \`maintenance_folio_counter\` WHERE \`prefix\` = 'MT'), 0)`);
    await q.query("UPDATE `maintenance_request` SET `folio` = CONCAT('SOL-', SUBSTRING(`folio`, 4)) WHERE `folio` LIKE 'MT-%'");
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query("UPDATE `maintenance_request` SET `folio` = CONCAT('MT-', SUBSTRING(`folio`, 5)) WHERE `folio` LIKE 'SOL-%'");
    for (const t of ['vehicle_spec_item', 'request_item', 'product_offer', 'product', 'product_category', 'unit_of_measure']) {
      await q.query(`DROP TABLE IF EXISTS \`${t}\``);
    }
    const drop = async (table: string, cols: string[]) => {
      for (const c of cols) if (await this.columnExists(q, table, c)) await q.query(`ALTER TABLE \`${table}\` DROP COLUMN \`${c}\``);
    };
    await drop('supplier', ['bankName', 'clabe', 'accountNumber']);
    await drop('maintenance_request', ['type', 'reviewedById', 'reviewedAt', 'rejectionReason']);
    await drop('maintenance_quote_item', ['requestItemId', 'productId', 'availability', 'leadTimeDays', 'ivaEnabled', 'iepsEnabled', 'iepsRate', 'quality']);
    await drop('maintenance_quote', ['ieps']);
    await drop('purchase_order', ['ieps']);
    await drop('purchase_order_item', ['requestItemId', 'productId', 'ivaEnabled', 'iepsEnabled', 'iepsRate']);
  }
}

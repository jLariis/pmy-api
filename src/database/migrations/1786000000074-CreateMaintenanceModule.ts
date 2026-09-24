import { MigrationInterface, QueryRunner } from 'typeorm';
import { randomUUID } from 'crypto';

/**
 * Módulo de Mantenimiento de Vehículos.
 *  - Catálogos: `maintenance_service_category` (semilla 12), `maintenance_service`, `supplier`, `supplier_contact`.
 *  - Flujo: `maintenance_request` → `maintenance_quote`(+items) → `purchase_order`(+items, +dispatch).
 *  - `maintenance_folio_counter` (SM/OC) para folios sin duplicados.
 *  - `vehicle.lastMaintenanceKms`, `vehicle.maintenanceIntervalKms` (default 5000).
 *  - `company_settings.maintenanceDeviationPct` (default 15).
 *  - SIN backfill de `vehicle.kms`: el histórico de capturas es basura en varias sucursales ("1 → 2", "00000",
 *    "1234556"); el km vivo arranca con las capturas nuevas (regla plausible) y se corrige a mano en Programación.
 * Sin FKs duras hacia tablas legacy (evita choques de collation, ver 016); solo índices.
 */
export class CreateMaintenanceModule1786000000074 implements MigrationInterface {
  name = 'CreateMaintenanceModule1786000000074';

  private async columnExists(qr: QueryRunner, table: string, column: string): Promise<boolean> {
    const rows = await qr.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column],
    );
    return Number(rows[0].c) > 0;
  }

  public async up(qr: QueryRunner): Promise<void> {
    // Sin COLLATE explícito: hereda el default de la BD (utf8mb4_0900_ai_ci) igual que vehicle/subsidiary/user;
    // forzar unicode_ci rompía los JOIN ("Illegal mix of collations").
    const T = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4';

    await qr.query(`
      CREATE TABLE IF NOT EXISTS \`maintenance_service_category\` (
        \`id\` varchar(36) NOT NULL,
        \`name\` varchar(100) NOT NULL,
        \`sortOrder\` int NOT NULL DEFAULT 0,
        \`active\` tinyint(1) NOT NULL DEFAULT 1,
        \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_msc_name\` (\`name\`)
      ) ${T}`);

    await qr.query(`
      CREATE TABLE IF NOT EXISTS \`maintenance_service\` (
        \`id\` varchar(36) NOT NULL,
        \`name\` varchar(150) NOT NULL,
        \`categoryId\` varchar(36) NOT NULL,
        \`unit\` enum('servicio','pieza','litro','juego') NOT NULL DEFAULT 'servicio',
        \`referencePrice\` decimal(12,2) NOT NULL DEFAULT 0,
        \`vehicleType\` enum('van','camioneta','rabon','3/4','urban','caja larga') NULL,
        \`active\` tinyint(1) NOT NULL DEFAULT 1,
        \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\` datetime NULL,
        \`deletedAt\` datetime NULL,
        PRIMARY KEY (\`id\`),
        KEY \`idx_ms_category\` (\`categoryId\`)
      ) ${T}`);

    await qr.query(`
      CREATE TABLE IF NOT EXISTS \`supplier\` (
        \`id\` varchar(36) NOT NULL,
        \`name\` varchar(200) NOT NULL,
        \`rfc\` varchar(20) NULL,
        \`address\` varchar(300) NULL,
        \`notes\` text NULL,
        \`active\` tinyint(1) NOT NULL DEFAULT 1,
        \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\` datetime NULL,
        \`deletedAt\` datetime NULL,
        PRIMARY KEY (\`id\`)
      ) ${T}`);

    await qr.query(`
      CREATE TABLE IF NOT EXISTS \`supplier_contact\` (
        \`id\` varchar(36) NOT NULL,
        \`supplierId\` varchar(36) NOT NULL,
        \`name\` varchar(150) NOT NULL,
        \`position\` varchar(100) NULL,
        \`email\` varchar(150) NULL,
        \`phone\` varchar(30) NULL,
        \`whatsapp\` varchar(30) NULL,
        \`preferredChannel\` enum('email','whatsapp') NOT NULL DEFAULT 'email',
        \`isDefault\` tinyint(1) NOT NULL DEFAULT 0,
        PRIMARY KEY (\`id\`),
        KEY \`idx_sc_supplier\` (\`supplierId\`)
      ) ${T}`);

    await qr.query(`
      CREATE TABLE IF NOT EXISTS \`maintenance_request\` (
        \`id\` varchar(36) NOT NULL,
        \`folio\` varchar(20) NOT NULL,
        \`vehicleId\` varchar(36) NOT NULL,
        \`subsidiaryId\` varchar(36) NOT NULL,
        \`kmsAtRequest\` int NULL,
        \`description\` text NOT NULL,
        \`priority\` enum('baja','media','alta') NOT NULL DEFAULT 'media',
        \`status\` enum('abierta','en_cotizacion','orden_generada','completada','cancelada') NOT NULL DEFAULT 'abierta',
        \`createdById\` varchar(36) NULL,
        \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\` datetime NULL,
        \`deletedAt\` datetime NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_mr_folio\` (\`folio\`),
        KEY \`idx_mr_vehicle\` (\`vehicleId\`),
        KEY \`idx_mr_subsidiary_status\` (\`subsidiaryId\`, \`status\`)
      ) ${T}`);

    await qr.query(`
      CREATE TABLE IF NOT EXISTS \`maintenance_quote\` (
        \`id\` varchar(36) NOT NULL,
        \`requestId\` varchar(36) NOT NULL,
        \`supplierId\` varchar(36) NOT NULL,
        \`quoteDate\` date NOT NULL,
        \`validUntil\` date NULL,
        \`notes\` text NULL,
        \`attachmentPath\` varchar(500) NULL,
        \`attachmentName\` varchar(255) NULL,
        \`attachmentMime\` varchar(100) NULL,
        \`subtotal\` decimal(12,2) NOT NULL DEFAULT 0,
        \`tax\` decimal(12,2) NOT NULL DEFAULT 0,
        \`total\` decimal(12,2) NOT NULL DEFAULT 0,
        \`status\` enum('capturada','ganadora','descartada') NOT NULL DEFAULT 'capturada',
        \`createdById\` varchar(36) NULL,
        \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\` datetime NULL,
        \`deletedAt\` datetime NULL,
        PRIMARY KEY (\`id\`),
        KEY \`idx_mq_request\` (\`requestId\`),
        KEY \`idx_mq_supplier\` (\`supplierId\`)
      ) ${T}`);

    await qr.query(`
      CREATE TABLE IF NOT EXISTS \`maintenance_quote_item\` (
        \`id\` varchar(36) NOT NULL,
        \`quoteId\` varchar(36) NOT NULL,
        \`serviceId\` varchar(36) NULL,
        \`description\` varchar(300) NOT NULL,
        \`quantity\` decimal(10,2) NOT NULL DEFAULT 1,
        \`unitPrice\` decimal(12,2) NOT NULL DEFAULT 0,
        \`taxRate\` decimal(5,4) NOT NULL DEFAULT 0.16,
        \`amount\` decimal(12,2) NOT NULL DEFAULT 0,
        \`referencePrice\` decimal(12,2) NULL,
        \`deviationPct\` decimal(8,2) NULL,
        PRIMARY KEY (\`id\`),
        KEY \`idx_mqi_quote\` (\`quoteId\`)
      ) ${T}`);

    await qr.query(`
      CREATE TABLE IF NOT EXISTS \`purchase_order\` (
        \`id\` varchar(36) NOT NULL,
        \`folio\` varchar(20) NOT NULL,
        \`requestId\` varchar(36) NOT NULL,
        \`quoteId\` varchar(36) NOT NULL,
        \`supplierId\` varchar(36) NOT NULL,
        \`contactId\` varchar(36) NULL,
        \`vehicleId\` varchar(36) NOT NULL,
        \`subsidiaryId\` varchar(36) NOT NULL,
        \`status\` enum('borrador','pendiente','autorizada','rechazada','enviada','completada','cancelada') NOT NULL DEFAULT 'borrador',
        \`notes\` text NULL,
        \`rejectionReason\` text NULL,
        \`authorizedById\` varchar(36) NULL,
        \`authorizedAt\` datetime NULL,
        \`subtotal\` decimal(12,2) NOT NULL DEFAULT 0,
        \`tax\` decimal(12,2) NOT NULL DEFAULT 0,
        \`total\` decimal(12,2) NOT NULL DEFAULT 0,
        \`completedAt\` datetime NULL,
        \`completedKms\` int NULL,
        \`finalAmount\` decimal(12,2) NULL,
        \`expenseId\` varchar(36) NULL,
        \`cancelReason\` text NULL,
        \`createdById\` varchar(36) NULL,
        \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\` datetime NULL,
        \`deletedAt\` datetime NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_po_folio\` (\`folio\`),
        KEY \`idx_po_request\` (\`requestId\`),
        KEY \`idx_po_vehicle\` (\`vehicleId\`),
        KEY \`idx_po_subsidiary_status\` (\`subsidiaryId\`, \`status\`)
      ) ${T}`);

    await qr.query(`
      CREATE TABLE IF NOT EXISTS \`purchase_order_item\` (
        \`id\` varchar(36) NOT NULL,
        \`purchaseOrderId\` varchar(36) NOT NULL,
        \`serviceId\` varchar(36) NULL,
        \`description\` varchar(300) NOT NULL,
        \`quantity\` decimal(10,2) NOT NULL DEFAULT 1,
        \`unitPrice\` decimal(12,2) NOT NULL DEFAULT 0,
        \`taxRate\` decimal(5,4) NOT NULL DEFAULT 0.16,
        \`amount\` decimal(12,2) NOT NULL DEFAULT 0,
        \`approved\` tinyint(1) NOT NULL DEFAULT 1,
        PRIMARY KEY (\`id\`),
        KEY \`idx_poi_po\` (\`purchaseOrderId\`)
      ) ${T}`);

    await qr.query(`
      CREATE TABLE IF NOT EXISTS \`purchase_order_dispatch\` (
        \`id\` varchar(36) NOT NULL,
        \`purchaseOrderId\` varchar(36) NOT NULL,
        \`channel\` enum('email','whatsapp') NOT NULL,
        \`destination\` varchar(200) NOT NULL,
        \`status\` enum('enviado','error') NOT NULL,
        \`kind\` varchar(20) NOT NULL DEFAULT 'orden',
        \`error\` text NULL,
        \`emailLogId\` varchar(36) NULL,
        \`sentById\` varchar(36) NULL,
        \`sentByName\` varchar(150) NULL,
        \`sentAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        KEY \`idx_pod_po\` (\`purchaseOrderId\`)
      ) ${T}`);

    await qr.query(`
      CREATE TABLE IF NOT EXISTS \`maintenance_folio_counter\` (
        \`prefix\` varchar(10) NOT NULL,
        \`lastValue\` int NOT NULL DEFAULT 0,
        PRIMARY KEY (\`prefix\`)
      ) ${T}`);
    await qr.query(`INSERT IGNORE INTO \`maintenance_folio_counter\` (\`prefix\`, \`lastValue\`) VALUES ('SM', 0), ('OC', 0)`);

    const categories = [
      'Afinación y motor', 'Frenos', 'Suspensión y dirección', 'Llantas', 'Transmisión y clutch',
      'Eléctrico y batería', 'Aire acondicionado', 'Carrocería y pintura', 'Refacciones',
      'Lavado y limpieza', 'Verificación y trámites', 'Otros',
    ];
    for (let i = 0; i < categories.length; i++) {
      await qr.query(
        'INSERT IGNORE INTO `maintenance_service_category` (`id`, `name`, `sortOrder`, `active`) VALUES (?, ?, ?, 1)',
        [randomUUID(), categories[i], i + 1],
      );
    }

    if (!(await this.columnExists(qr, 'vehicle', 'lastMaintenanceKms'))) {
      await qr.query('ALTER TABLE `vehicle` ADD COLUMN `lastMaintenanceKms` int NULL');
    }
    if (!(await this.columnExists(qr, 'vehicle', 'maintenanceIntervalKms'))) {
      await qr.query('ALTER TABLE `vehicle` ADD COLUMN `maintenanceIntervalKms` int NOT NULL DEFAULT 5000');
    }
    if (!(await this.columnExists(qr, 'company_settings', 'maintenanceDeviationPct'))) {
      await qr.query('ALTER TABLE `company_settings` ADD COLUMN `maintenanceDeviationPct` decimal(5,2) NOT NULL DEFAULT 15');
    }
  }

  public async down(qr: QueryRunner): Promise<void> {
    for (const t of [
      'purchase_order_dispatch', 'purchase_order_item', 'purchase_order', 'maintenance_quote_item',
      'maintenance_quote', 'maintenance_request', 'supplier_contact', 'supplier', 'maintenance_service',
      'maintenance_service_category', 'maintenance_folio_counter',
    ]) {
      await qr.query(`DROP TABLE IF EXISTS \`${t}\``);
    }
    if (await this.columnExists(qr, 'vehicle', 'lastMaintenanceKms')) await qr.query('ALTER TABLE `vehicle` DROP COLUMN `lastMaintenanceKms`');
    if (await this.columnExists(qr, 'vehicle', 'maintenanceIntervalKms')) await qr.query('ALTER TABLE `vehicle` DROP COLUMN `maintenanceIntervalKms`');
    if (await this.columnExists(qr, 'company_settings', 'maintenanceDeviationPct')) {
      await qr.query('ALTER TABLE `company_settings` DROP COLUMN `maintenanceDeviationPct`');
    }
  }
}

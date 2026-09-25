import { MigrationInterface, QueryRunner } from 'typeorm';

/** Compras v3: bitácora de "Pedir cotización" (envíos de la solicitud de cotización a proveedores). Sin COLLATE explícito. */
export class CreateRequestDispatch1786000000080 implements MigrationInterface {
  name = 'CreateRequestDispatch1786000000080';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE IF NOT EXISTS \`request_dispatch\` (
      \`id\` varchar(36) NOT NULL, \`requestId\` varchar(36) NOT NULL, \`supplierId\` varchar(36) NOT NULL,
      \`channel\` enum('email','whatsapp') NOT NULL, \`destination\` varchar(200) NOT NULL, \`status\` enum('enviado','error') NOT NULL,
      \`kind\` varchar(20) NOT NULL DEFAULT 'rfq', \`error\` text NULL, \`emailLogId\` varchar(36) NULL,
      \`sentById\` varchar(36) NULL, \`sentByName\` varchar(150) NULL, \`sentAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`), KEY \`idx_rd_request\` (\`requestId\`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE IF EXISTS `request_dispatch`');
  }
}

import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Agrega el valor `entregado_en_bodega` al enum de estatus en las 3 columnas
 * que lo usan (shipment, charge_shipment, shipment_status). Es necesario porque
 * `status` es una columna ENUM de MySQL: sin este ALTER, guardar el nuevo valor
 * falla con "Data truncated for column 'status'".
 */
export class AddEntregadoEnBodegaStatus1786000000000 implements MigrationInterface {
  name = 'AddEntregadoEnBodegaStatus1786000000000'

  // Lista COMPLETA de valores (incluye el nuevo al final).
  private readonly withNew = [
    'recoleccion', 'recibido_en_bodega', 'pendiente', 'en_ruta', 'en_transito',
    'entregado', 'no_entregado', 'desconocido', 'rechazado', 'devuelto_a_fedex',
    'es_ocurre', 'en_bodega', 'retorno_abandono_fedex', 'estacion_fedex',
    'llegado_despues', 'direccion_incorrecta', 'cliente_no_disponible',
    'cambio_fecha_solicitado', 'acargo_de_fedex', 'entregado_por_fedex',
    'demora_en_entrega', 'empresa_cerrada', 'no_se_pudo_recolectar_el_cobro',
    'otro', 'entregado_en_bodega',
  ];

  private enumList(values: string[]): string {
    return values.map((v) => `'${v}'`).join(', ');
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    const list = this.enumList(this.withNew);

    await queryRunner.query(
      `ALTER TABLE \`shipment\` MODIFY COLUMN \`status\` ENUM(${list}) NOT NULL DEFAULT 'pendiente'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`charge_shipment\` MODIFY COLUMN \`status\` ENUM(${list}) NOT NULL DEFAULT 'pendiente'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`shipment_status\` MODIFY COLUMN \`status\` ENUM(${list}) NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revertimos al enum sin el valor nuevo. Si existen filas con
    // 'entregado_en_bodega', primero hay que reasignarlas o esto fallará.
    const without = this.withNew.filter((v) => v !== 'entregado_en_bodega');
    const list = this.enumList(without);

    await queryRunner.query(
      `ALTER TABLE \`shipment\` MODIFY COLUMN \`status\` ENUM(${list}) NOT NULL DEFAULT 'pendiente'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`charge_shipment\` MODIFY COLUMN \`status\` ENUM(${list}) NOT NULL DEFAULT 'pendiente'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`shipment_status\` MODIFY COLUMN \`status\` ENUM(${list}) NOT NULL`,
    );
  }
}

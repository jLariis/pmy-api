import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Mejora las ETIQUETAS (label) de los valores de catálogo sembrados por la 009.
 * El seed original usaba `prettify(key)` → muchos labels quedaron en inglés, sin
 * acentos o con siglas mal escritas ("Recoleccion", "Initial", "Dhl", "Paid"...).
 * Aquí se fijan etiquetas en buen español por (type, key).
 *
 * Solo toca `label`. NO cambia `key`/`type`/`isSystem` (el código sigue usando la key).
 * Idempotente y no destructivo de personalizaciones: únicamente actualiza la fila
 * si su label sigue siendo el valor por defecto del seed (NO pisa ediciones del
 * usuario). Down() es no-op (no degradamos labels a propósito).
 */
export class PrettifyCatalogLabels1786000000010 implements MigrationInterface {
  name = 'PrettifyCatalogLabels1786000000010';

  public async up(q: QueryRunner): Promise<void> {
    // type -> { key: labelEspañol }
    const LABELS: Record<string, Record<string, string>> = {
      status: { activo: 'Activo', inactivo: 'Inactivo' },
      vehicle_status: {
        activo: 'Activo',
        inactivo: 'Inactivo',
        mantenimiento: 'Mantenimiento',
        'fuera de servicio': 'Fuera de servicio',
      },
      vehicle_type: {
        van: 'Van',
        camioneta: 'Camioneta',
        rabon: 'Rabón',
        '3/4': '3/4',
        urban: 'Urban',
        'caja larga': 'Caja larga',
      },
      priority: { alta: 'Alta', media: 'Media', baja: 'Baja' },
      shipment_type: { fedex: 'FedEx', dhl: 'DHL', other: 'Otro' },
      shipment_status: {
        recoleccion: 'Recolección',
        recibido_en_bodega: 'Recibido en bodega',
        pendiente: 'Pendiente',
        en_ruta: 'En ruta',
        en_transito: 'En tránsito',
        entregado: 'Entregado',
        no_entregado: 'No entregado',
        desconocido: 'Desconocido',
        rechazado: 'Rechazado',
        devuelto_a_fedex: 'Devuelto a FedEx',
        es_ocurre: 'Es ocurre',
        entregado_en_bodega: 'Entregado en bodega',
        en_bodega: 'En bodega',
        retorno_abandono_fedex: 'Retorno/abandono FedEx',
        estacion_fedex: 'Estación FedEx',
        llegado_despues: 'Llegado después',
        direccion_incorrecta: 'Dirección incorrecta',
        cliente_no_disponible: 'Cliente no disponible',
        cambio_fecha_solicitado: 'Cambio de fecha solicitado',
        acargo_de_fedex: 'A cargo de FedEx',
        entregado_por_fedex: 'Entregado por FedEx',
        demora_en_entrega: 'Demora en entrega',
        empresa_cerrada: 'Empresa cerrada',
        no_se_pudo_recolectar_el_cobro: 'No se pudo recolectar el cobro',
        otro: 'Otro',
      },
      shipment_canceled_status: { dex08: 'DEX08', dex07: 'DEX07', dex03: 'DEX03' },
      income_status: {
        entregado: 'Entregado',
        rechazado: 'Rechazado',
        no_entregado: 'No entregado',
        cliente_no_disponible_3ra_visita: 'Cliente no disponible (3ra visita)',
        tyco: 'Tyco',
        aeropuerto: 'Aeropuerto',
        traslado_especial: 'Traslado especial',
      },
      income_source_type: {
        shipment: 'Envío',
        collection: 'Recolección',
        charge: 'Cargo',
        manual: 'Manual',
        tyco: 'Tyco',
        aeropuerto: 'Aeropuerto',
        special_transfer: 'Traslado especial',
      },
      payment_status: { paid: 'Pagado', pending: 'Pendiente', failed: 'Fallido' },
      payment_type: { FTC: 'FTC', COD: 'COD', ROD: 'ROD' },
      frequency: {
        'Único': 'Único',
        Diario: 'Diario',
        Semanal: 'Semanal',
        Mensual: 'Mensual',
        Anual: 'Anual',
      },
      consolidated_type: { ordinario: 'Ordinaria', carga: 'Carga', aereo: 'Aéreo' },
      inventory_type: { initial: 'Inicial', dex: 'DEX', final: 'Final' },
      outbound_type: { dispatch: 'Despacho', transfer: 'Traslado' },
      transfer_type: {
        tyco: 'Tyco',
        aeropuerto: 'Aeropuerto',
        sucursal: 'Sucursal',
        otro: 'Otro',
      },
    };

    // Reconstruye el label por defecto que generó el seed (prettify) para no pisar
    // ediciones manuales: solo actualiza si el label actual === prettify(key).
    const prettify = (value: string): string => {
      const s = value.replace(/[_-]/g, ' ').trim();
      return s.charAt(0).toUpperCase() + s.slice(1);
    };

    for (const [type, map] of Object.entries(LABELS)) {
      for (const [key, label] of Object.entries(map)) {
        await q.query(
          `UPDATE \`catalog_item\` SET \`label\` = ?
             WHERE \`type\` = ? AND \`key\` = ? AND \`label\` = ?`,
          [label, type, key, prettify(key)],
        );
      }
    }
  }

  public async down(): Promise<void> {
    // no-op: no degradamos las etiquetas.
  }
}

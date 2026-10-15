import { EntityManager } from 'typeorm';

/** Ingreso vivo de OTRO registro de la misma pieza que ya cubre a este registro. */
export interface SiblingIncomeRow {
  id: string;
  incomeType: string;
  date: Date;
  shipmentId: string;
}

/**
 * Ingresos vivos que OTRO registro de la misma guía (misma pieza) ya cobró con fecha posterior al
 * alta de este registro. Cuando una guía vuelve a entrar en otro consolidado, la entrega o el DEX
 * es UN solo evento físico: lo cobra el primero que llega (cron sobre el registro viejo o cierre
 * sobre el nuevo) y el otro lo debe ver como "ya cobrado". Caso 383894126080 (Bodega Hermosillo,
 * 13-oct-2026): el cron cobró la entrega al registro del 12-oct y el cierre de la ruta del 13 la
 * cobró otra vez al registro del 13.
 *
 * Lo cobrado ANTES de que existiera este registro no cuenta: es de su propio flujo (caso
 * 878249671370: el consolidado nuevo sí cobra aunque el viejo tenga ingreso o anulación previa).
 * DHL: varias piezas comparten guía maestra; se distinguen por dhlUniqueId (sin pieza no se compara).
 * SQL directo: filtrar `active = 1` a mano.
 */
export async function siblingIncomesSinceCreated(
  manager: EntityManager,
  shipmentId: string,
  trackingNumber: string,
  opts: { incomeType?: string; from?: Date; to?: Date } = {},
): Promise<SiblingIncomeRow[]> {
  if (!shipmentId || !trackingNumber) return [];
  const params: any[] = [shipmentId, trackingNumber];
  let extra = '';
  if (opts.incomeType) { extra += ' AND i.incomeType = ?'; params.push(opts.incomeType); }
  if (opts.from) { extra += ' AND i.date >= ?'; params.push(opts.from); }
  if (opts.to) { extra += ' AND i.date <= ?'; params.push(opts.to); }
  const rows: SiblingIncomeRow[] = await manager.query(
    `SELECT i.id, i.incomeType, i.date, i.shipmentId
       FROM income i
       JOIN shipment o ON o.id = i.shipmentId
       JOIN shipment cur ON cur.id = ?
      WHERE o.trackingNumber = ?
        AND o.id <> cur.id
        AND COALESCE(o.dhlUniqueId, '') = COALESCE(cur.dhlUniqueId, '')
        AND (cur.shipmentType <> 'dhl' OR COALESCE(cur.dhlUniqueId, '') <> '')
        AND i.active = 1
        AND i.sourceType = 'shipment'
        AND i.date >= cur.createdAt${extra}
      ORDER BY i.date DESC`,
    params,
  );
  return rows.map((r) => ({ ...r, date: new Date(r.date) }));
}

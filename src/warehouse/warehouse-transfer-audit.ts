import { format, toZonedTime } from 'date-fns-tz';
import { AuditAction } from 'src/common/enums/audit.enum';
import { ShipmentStatusType } from 'src/common/enums';

/**
 * Bitácora de un TRASPASO de bodega para auditorías posteriores: quién (lo pone
 * el interceptor), de dónde a dónde, cuándo, con qué unidad/choferes y en qué
 * estado estaba CADA guía antes de moverse. Se arma dentro de la transacción
 * (antes de actualizar) y viaja en la respuesta como `audit`; el interceptor la
 * guarda en `audit_log` (descripción legible + afterState con el detalle).
 */

const TIME_ZONE = 'America/Hermosillo';

const DELIVERED = new Set<string>([
  ShipmentStatusType.ENTREGADO,
  ShipmentStatusType.ENTREGADO_POR_FEDEX,
  ShipmentStatusType.ENTREGADO_EN_BODEGA,
]);

export interface TransferAuditPackageInput {
  id: string;
  trackingNumber?: string | null;
  isCharge: boolean;
  /** Registro tal cual estaba en BD antes del traspaso (null = no se encontró). */
  before: {
    status?: string | null;
    subsidiary?: { id?: string | null; name?: string | null } | null;
  } | null;
}

export interface TransferAuditInput {
  outboundId: string;
  folio?: string | null;
  origin: { id: string; name?: string | null };
  destination: { id: string; name?: string | null };
  vehicle?: { id?: string | null; name?: string | null; plateNumber?: string | null } | null;
  drivers?: { id?: string | null; name?: string | null }[] | null;
  packages: TransferAuditPackageInput[];
  now?: Date;
}

export interface TransferAudit {
  tipo: 'traspaso';
  outboundId: string;
  folio: string | null;
  origen: { id: string; nombre: string };
  destino: { id: string; nombre: string };
  unidad: { id: string | null; nombre: string; placas: string | null } | null;
  choferes: { id: string | null; nombre: string }[];
  fechaUtc: string;
  fechaHermosillo: string;
  total: number;
  porEstatusAnterior: Record<string, number>;
  avisos: { fueraDeOrigen: number; yaEntregadas: number; noEncontradas: number };
  paquetes: {
    id: string;
    guia: string;
    carga: boolean;
    sucursalAnteriorId: string | null;
    sucursalAnterior: string | null;
    estatusAnterior: string | null;
    estatusNuevo: string;
    sucursalNuevaId: string;
  }[];
}

const nameOr = (v: string | null | undefined, fallback: string) => (v ?? '').trim() || fallback;

export function buildTransferAudit(input: TransferAuditInput): TransferAudit {
  const now = input.now ?? new Date();
  const porEstatusAnterior: Record<string, number> = {};
  const avisos = { fueraDeOrigen: 0, yaEntregadas: 0, noEncontradas: 0 };

  const paquetes = input.packages.map((p) => {
    const prevStatus = p.before?.status ?? null;
    const prevSubId = p.before?.subsidiary?.id ?? null;
    if (!p.before) avisos.noEncontradas++;
    else {
      if (prevSubId !== input.origin.id) avisos.fueraDeOrigen++;
      if (prevStatus && DELIVERED.has(prevStatus)) avisos.yaEntregadas++;
    }
    const key = prevStatus ?? 'no_encontrado';
    porEstatusAnterior[key] = (porEstatusAnterior[key] ?? 0) + 1;
    return {
      id: p.id,
      guia: p.trackingNumber ?? '',
      carga: p.isCharge,
      sucursalAnteriorId: prevSubId,
      sucursalAnterior: p.before?.subsidiary?.name ?? null,
      estatusAnterior: prevStatus,
      estatusNuevo: ShipmentStatusType.EN_RUTA as string,
      sucursalNuevaId: input.destination.id,
    };
  });

  return {
    tipo: 'traspaso',
    outboundId: input.outboundId,
    folio: input.folio ?? null,
    origen: { id: input.origin.id, nombre: nameOr(input.origin.name, 'N/D') },
    destino: { id: input.destination.id, nombre: nameOr(input.destination.name, 'N/D') },
    unidad: input.vehicle
      ? {
          id: input.vehicle.id ?? null,
          nombre: nameOr(input.vehicle.name, 'N/D'),
          placas: input.vehicle.plateNumber ?? null,
        }
      : null,
    choferes: (input.drivers ?? []).map((d) => ({ id: d.id ?? null, nombre: nameOr(d.name, 'N/D') })),
    fechaUtc: now.toISOString(),
    fechaHermosillo: format(toZonedTime(now, TIME_ZONE), 'yyyy-MM-dd HH:mm:ss', { timeZone: TIME_ZONE }),
    total: paquetes.length,
    porEstatusAnterior,
    avisos,
    paquetes,
  };
}

/** Descripción legible para la bitácora: "Traspasó 109 paquetes de A a B · folio … · unidad … · chofer …". */
export function describeTransferAudit(a: TransferAudit): string {
  const parts = [
    `Traspasó ${a.total} paquete${a.total === 1 ? '' : 's'} de ${a.origen.nombre} a ${a.destino.nombre}`,
  ];
  if (a.folio) parts.push(`folio ${a.folio}`);
  if (a.unidad) parts.push(`unidad ${a.unidad.nombre}`);
  if (a.choferes.length) parts.push(`chofer ${a.choferes.map((c) => c.nombre).join(', ')}`);
  if (a.avisos.yaEntregadas) parts.push(`${a.avisos.yaEntregadas} ya entregadas`);
  if (a.avisos.fueraDeOrigen) parts.push(`${a.avisos.fueraDeOrigen} no estaban en ${a.origen.nombre}`);
  if (a.avisos.noEncontradas) parts.push(`${a.avisos.noEncontradas} no encontradas`);
  return parts.join(' · ');
}

/**
 * `describe` del @Audit de POST /warehouse/outbound. Solo actúa en traspasos
 * exitosos (la respuesta trae `audit`); el resto cae al catálogo central.
 */
export function describeOutboundForAudit(ctx: { response: any; result: 'success' | 'error' }) {
  const a: TransferAudit | undefined = ctx.response?.audit;
  if (ctx.result !== 'success' || a?.tipo !== 'traspaso') return undefined;
  const { paquetes, ...resumen } = a;
  return {
    message: describeTransferAudit(a),
    action: AuditAction.TRANSFER,
    entityName: 'Traspaso',
    details: resumen,
  };
}

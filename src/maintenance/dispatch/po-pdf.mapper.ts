import { PurchaseOrder } from 'src/entities/purchase-order.entity';
import { amountToWordsMXN } from '../utils/amount-to-words.util';
import { totals } from '../utils/money.util';
import { userDisplayName } from '../maintenance-scope.util';

export interface PoPdfRow {
  index: number;
  quantity: string;
  description: string;
  unitPrice: string;
  amount: string;
}

export interface PoPdfData {
  title: string;
  folio: string;
  date: string;
  isDraft: boolean;
  statusLabel: string;
  subsidiaryName: string;
  requestFolio: string;
  supplier: { name: string; rfc: string; address: string };
  contact: { name: string; email: string; phone: string };
  vehicle: { label: string; plates: string; brandModel: string; kms: string };
  rows: PoPdfRow[];
  subtotal: string;
  tax: string;
  total: string;
  totalInWords: string;
  notes: string;
  hasNotes: boolean;
  authorizedBy: string;
  authorizedAt: string;
}

const money = (n: number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n || 0));
const qty = (n: number) => (Number.isInteger(Number(n)) ? String(Number(n)) : Number(n).toFixed(2));
const day = (d?: Date | string | null) =>
  d ? new Date(d).toLocaleDateString('es-MX', { timeZone: 'America/Hermosillo', day: '2-digit', month: 'long', year: 'numeric' }) : '';

/** Datos de la plantilla `purchase_order_pdf`. Solo lleva las partidas APROBADAS (lo que se envía al proveedor). */
export function mapPurchaseOrderToPdf(po: PurchaseOrder): PoPdfData {
  const approved = (po.items ?? []).filter((i) => i.approved !== false);
  const t = totals(approved.map((i) => ({ quantity: Number(i.quantity), unitPrice: Number(i.unitPrice), taxRate: Number(i.taxRate) })));
  const isDraft = !['autorizada', 'enviada', 'completada'].includes(po.status);
  const v = po.vehicle;
  return {
    title: 'ORDEN DE COMPRA',
    folio: po.folio,
    date: day(po.authorizedAt ?? po.createdAt),
    isDraft,
    statusLabel: isDraft ? 'BORRADOR — NO VÁLIDA SIN AUTORIZACIÓN' : '',
    subsidiaryName: po.subsidiary?.name ?? '',
    requestFolio: po.request?.folio ?? '',
    supplier: { name: po.supplier?.name ?? '', rfc: po.supplier?.rfc ?? '', address: po.supplier?.address ?? '' },
    contact: { name: po.contact?.name ?? '', email: po.contact?.email ?? '', phone: po.contact?.whatsapp || po.contact?.phone || '' },
    vehicle: {
      label: [v?.code, v?.name].filter(Boolean).join(' · ') || v?.plateNumber || '',
      plates: v?.plateNumber ?? '',
      brandModel: [v?.brand, v?.model].filter(Boolean).join(' '),
      kms: v?.kms ? `${Number(v.kms).toLocaleString('es-MX')} km` : '',
    },
    rows: approved.map((i, idx) => ({
      index: idx + 1,
      quantity: qty(Number(i.quantity)),
      description: i.description,
      unitPrice: money(Number(i.unitPrice)),
      amount: money(Number(i.quantity) * Number(i.unitPrice)),
    })),
    subtotal: money(t.subtotal),
    tax: money(t.tax),
    total: money(t.total),
    totalInWords: amountToWordsMXN(t.total),
    notes: po.notes ?? '',
    hasNotes: !!po.notes?.trim(),
    authorizedBy: po.authorizedBy ? userDisplayName(po.authorizedBy) : '',
    authorizedAt: po.authorizedAt ? day(po.authorizedAt) : '',
  };
}

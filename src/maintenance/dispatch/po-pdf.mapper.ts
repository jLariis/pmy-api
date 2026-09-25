import { PurchaseOrder } from 'src/entities/purchase-order.entity';
import { amountToWordsMXN } from '../utils/amount-to-words.util';
import { lineTaxes, MoneyItem, totals } from '../utils/money.util';
import { REQUEST_TYPE_LABEL, taxLabel } from '../utils/labels.util';
import { userDisplayName } from '../maintenance-scope.util';

export interface PoPdfRow {
  index: number;
  quantity: string;
  description: string;
  unitPrice: string;
  taxLabel: string;
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
  requestType: string;
  supplier: { name: string; rfc: string; address: string };
  contact: { name: string; email: string; phone: string };
  vehicle: { label: string; plates: string; brandModel: string; kms: string };
  rows: PoPdfRow[];
  subtotal: string;
  ieps: string;
  hasIeps: boolean;
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
  const money$ = approved.map((i): MoneyItem => ({
    quantity: Number(i.quantity), unitPrice: Number(i.unitPrice), taxRate: Number(i.taxRate),
    ivaEnabled: i.ivaEnabled ?? null, iepsEnabled: i.iepsEnabled ?? null, iepsRate: Number(i.iepsRate ?? 0),
  }));
  const t = totals(money$);
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
    requestType: po.request?.type ? REQUEST_TYPE_LABEL[po.request.type] : '',
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
      taxLabel: taxLabel(money$[idx]),
      amount: money(lineTaxes(money$[idx]).amount),
    })),
    subtotal: money(t.subtotal),
    ieps: money(t.ieps),
    hasIeps: t.ieps > 0,
    tax: money(t.tax),
    total: money(t.total),
    totalInWords: amountToWordsMXN(t.total),
    notes: po.notes ?? '',
    hasNotes: !!po.notes?.trim(),
    authorizedBy: po.authorizedBy ? userDisplayName(po.authorizedBy) : '',
    authorizedAt: po.authorizedAt ? day(po.authorizedAt) : '',
  };
}

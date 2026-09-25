import { MaintenanceRequest } from 'src/entities/maintenance-request.entity';
import { Supplier } from 'src/entities/supplier.entity';
import { SupplierContact } from 'src/entities/supplier-contact.entity';
import { Comparison } from '../utils/comparison.util';
import { availabilityLabel, REQUEST_TYPE_LABEL } from '../utils/labels.util';
import { round2 } from '../utils/money.util';

const money = (n: number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n || 0));
const qty = (n: number) => (Number.isInteger(Number(n)) ? String(Number(n)) : Number(n).toFixed(2));
const day = (d: Date | string) =>
  new Date(d).toLocaleDateString('es-MX', { timeZone: 'America/Hermosillo', day: '2-digit', month: 'long', year: 'numeric' });
const stars = (n?: number | null) => (n ? '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n)) : '');

const vehicleLabel = (r: MaintenanceRequest) => {
  const v = r.vehicle;
  if (!v) return '';
  return [v.code, v.name].filter(Boolean).join(' · ') || v.plateNumber || '';
};

const sortedItems = (r: MaintenanceRequest) => [...(r.items ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);

/** Datos de la plantilla `request_quote_pdf`: lo que se le pide cotizar a un proveedor (sin precios). */
export function mapRequestToRfqPdf(
  r: MaintenanceRequest,
  supplier: Pick<Supplier, 'name'>,
  contact: SupplierContact | null,
  sender: { name: string; email?: string | null },
  notes?: string | null,
) {
  const v = r.vehicle;
  return {
    folio: r.folio,
    date: day(new Date()),
    subsidiaryName: r.subsidiary?.name ?? '',
    supplier: { name: supplier.name },
    contact: { name: contact?.name ?? '', email: contact?.email ?? '', phone: contact?.whatsapp || contact?.phone || '' },
    vehicle: { label: vehicleLabel(r), plates: v?.plateNumber ?? '', brandModel: [v?.brand, v?.model].filter(Boolean).join(' ') },
    requestType: REQUEST_TYPE_LABEL[r.type] ?? '',
    description: r.description ?? '',
    rows: sortedItems(r).map((i, idx) => ({
      index: idx + 1,
      quantity: qty(Number(i.quantity)),
      unit: i.unit?.abbreviation || i.unit?.name || '',
      description: i.description,
      detail: [i.product?.brand, i.product?.partNumber ? `No. parte ${i.product.partNumber}` : null, i.notes].filter(Boolean).join(' · '),
    })),
    requestedBy: sender.name,
    replyTo: sender.email ?? '',
    notes: notes?.trim() ?? '',
    hasNotes: !!notes?.trim(),
  };
}

/** Datos de la plantilla `purchase_comparison_pdf`: matriz renglón × proveedor con lo elegido. */
export function mapComparisonToPdf(
  r: MaintenanceRequest,
  c: Comparison,
  units: Record<string, string | null>,
  preparedBy: string,
) {
  const selection = new Map<string, { name: string; count: number; total: number }>();
  const rows = c.rows.map((row, idx) => ({
    index: idx + 1,
    description: row.description,
    quantity: qty(row.quantity),
    unit: units[row.requestItemId] ?? '',
    cells: c.quotes.map((q) => {
      const cell = row.cells[q.id];
      if (!cell) return { has: false, cls: 'none' };
      const selected = row.selectedQuoteItemId === cell.quoteItemId;
      if (selected) {
        const s = selection.get(q.id) ?? { name: q.supplierName, count: 0, total: 0 };
        s.count += 1;
        s.total = round2(s.total + cell.total);
        selection.set(q.id, s);
      }
      return {
        has: true,
        cls: [row.bestQuoteItemId === cell.quoteItemId ? 'best' : '', selected ? 'sel' : ''].filter(Boolean).join(' '),
        unitPrice: money(cell.unitPrice),
        total: money(cell.total),
        availability: availabilityLabel(cell.availability, cell.leadTimeDays),
        noStock: cell.availability === 'no',
        quality: stars(cell.quality),
        selected,
      };
    }),
  }));
  const sel = [...selection.values()];
  return {
    folio: r.folio,
    date: day(new Date()),
    subsidiaryName: r.subsidiary?.name ?? '',
    requestType: REQUEST_TYPE_LABEL[r.type] ?? '',
    vehicleLabel: vehicleLabel(r),
    description: r.description ?? '',
    suppliers: c.quotes.map((q) => ({ name: q.supplierName, total: money(q.total), covered: `${q.covered} de ${c.rows.length}` })),
    rows,
    selection: sel.map((s) => ({ name: s.name, count: s.count, total: money(s.total) })),
    hasSelection: sel.length > 0,
    selectionCount: sel.reduce((a, s) => a + s.count, 0),
    selectionTotal: money(round2(sel.reduce((a, s) => a + s.total, 0))),
    preparedBy,
  };
}

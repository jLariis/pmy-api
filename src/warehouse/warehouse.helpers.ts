export function hydratePackageIds(shipments: { id: string }[]): string[] {
  return Array.from(new Set((shipments || []).map((s) => s.id).filter(Boolean)));
}

export function splitShipmentIds(
  shipments: { id: string; isCharge?: boolean }[],
): { normalIds: string[]; chargeIds: string[] } {
  const normalIds: string[] = [];
  const chargeIds: string[] = [];
  for (const s of shipments || []) {
    if (s.isCharge) chargeIds.push(s.id);
    else normalIds.push(s.id);
  }
  return { normalIds, chargeIds };
}

/**
 * Resuelve el cobro (COD) de un paquete de bodega para los archivos generados
 * (Excel y PDF). Fuente única de verdad del criterio de cobro para que los
 * mappers gemelos `buildWarehouseExcelData`/`buildWarehousePdfData` (y el
 * generador legacy exceljs) NO vuelvan a divergir.
 *
 * Regla: hay cobro cuando el paquete trae `payment.amount` (relación hidratada)
 * o `paymentAmount` (aplanado). NO depende de `isCharge` (tipo de entidad): el
 * cobro se carga sobre los envíos NORMALES (`Shipment`, vía `processFileCharges`),
 * que tienen `isCharge=false`. Condicionar a `isCharge` ocultaba el cobro real.
 *
 * También resuelve el TIPO de cobro (`payment.type` / `paymentType`): COD, FTC,
 * ROD. Lo consume `formatPaymentDisplay` para mostrar "COD $1500.00".
 */
export function resolvePackagePayment(pkg: {
  payment?: { amount?: number | null; type?: string | null } | null;
  paymentAmount?: number | null;
  paymentType?: string | null;
}): { amount: number | null; hasPayment: boolean; type: string | null } {
  const amount = pkg?.payment?.amount ?? pkg?.paymentAmount ?? null;
  const type = pkg?.payment?.type ?? pkg?.paymentType ?? null;
  return { amount, hasPayment: amount != null, type };
}

/**
 * Formatea la celda de "Cobro" para los archivos generados (Excel y PDF)
 * anteponiendo el TIPO de cobro al monto: "COD $1500.00", "FTC $958.44".
 * Sin cobro => "N/A". Fuente única del formato para que los mappers gemelos
 * `buildWarehouseExcelData`/`buildWarehousePdfData` (y los generadores legacy)
 * NO vuelvan a divergir.
 */
export function formatPaymentDisplay(amount: number | null, type?: string | null): string {
  if (amount == null) return 'N/A';
  const money = `$${Number(amount).toFixed(2)}`;
  return type ? `${type} ${money}` : money;
}

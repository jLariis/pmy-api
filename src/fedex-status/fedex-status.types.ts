import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';

/** Último evento de scan, ya normalizado. */
export interface LatestScanEvent {
  type: string | null;
  description: string | null;
  date: Date | null;
  location: string | null;
  exceptionCode: string | null;
}

/** Validación de la respuesta de FedEx (calidad del dato, no del negocio). */
export interface StatusValidation {
  ok: boolean;
  issues: string[];
}

/**
 * Resultado canónico de "último estatus" de un paquete. Read-only: describe lo que FedEx
 * reporta AHORA, ya normalizado y validado; NO persiste nada. El caller decide si guarda.
 */
export interface LatestStatusResult {
  trackingNumber: string;
  found: boolean;

  /** Estatus local canónico (mapeo NUEVO, independiente de los mapeos legados). */
  status: ShipmentStatusType | null;

  // Campos crudos de FedEx que sustentan el estatus (para trazabilidad).
  derivedCode: string | null;
  statusCode: string | null;
  exceptionCode: string | null;
  statusByLocale: string | null;
  description: string | null;

  isDelivered: boolean;
  isTerminal: boolean;

  lastEvent: LatestScanEvent | null;
  commitDateTime: Date | null;

  validation: StatusValidation;
  fetchedAt: Date;

  /** Mensaje de error de FedEx o de red, si la consulta no resolvió. */
  error?: string;
}

/** Resultado de la verificación cruzada (API vs. segunda fuente). */
export interface StatusVerificationResult {
  trackingNumber: string;
  apiStatus: ShipmentStatusType | null;
  /** Fuente usada para el contraste: 'scrape' (sitio público) o 'legacy' (fallback interno). */
  secondarySource: 'scrape' | 'legacy';
  secondaryStatus: ShipmentStatusType | null;
  match: boolean;
  note?: string;
}

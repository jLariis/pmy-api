export type ImportJobKind = 'master' | 'charge';

/** Fila canónica ya mapeada por el FE (espejo de table.rows[].values + isHighValue). */
export interface CanonicalRow {
  trackingNumber: string;
  recipientName?: string;
  recipientAddress?: string;
  recipientCity?: string;
  recipientZip?: string;
  commitDate?: string;
  commitTime?: string;
  recipientPhone?: string;
  cod?: string;
  isHighValue?: boolean;
}

export interface ImportJobResult {
  failedTrackings: { trackingNumber: string; reason: string }[];
  duplicatedTrackings: string[];
  cobrosUnmatchedTrackings: string[];
  summary: Record<string, number>;
}

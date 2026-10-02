/** Tipos compartidos del módulo de bandeja de correo FedEx. */

export type AttachmentKind =
  | 'master'
  | 'master_aereo'
  | 'f2'
  | 'high_value'
  | 'ccp'
  | 'ccp_ignored'
  | 'dhl'
  | 'pdf'
  | 'other';

export type ConsolidationKind = 'master' | 'f2' | 'aereo' | 'high_value' | 'dhl';

export interface AnnouncedCons {
  consNumber: string;
  kind: 'master' | 'f2';
  announcedCount: number | null;
}

export interface Cobro {
  trackingNumber: string;
  date: string | null; // MM/DD/YYYY tal como viene
  concept: string; // COD-COLLECT CASH / FTC-COLLECT CASH / PIP NO AHS
  amount: number | null;
}

export interface SheetSummary {
  rowCount: number;
  zips: Record<string, number>;
  cities: Record<string, number>;
  looksFedex: boolean;
  isDhl: boolean;
  parseError?: string;
}

export type SignalType =
  | 'consolidado_conocido'
  | 'cp_archivo'
  | 'ciudad_archivo'
  | 'asunto_o_archivo'
  | 'cuerpo'
  | 'remitente'
  | 'copia'
  | 'estacion';

export interface Signal {
  type: SignalType;
  value: string;
  subsidiaryId: string;
  weight: number;
  note: string;
}

export type AliasSignalType = 'termino' | 'remitente' | 'copia' | 'estacion';

export interface KnowledgeAlias {
  signalType: AliasSignalType;
  term: string;
  subsidiaryId: string;
  hits: number;
  misses: number;
}

export type Region = 'BCS' | 'SON';

export interface Knowledge {
  subsidiaries: { id: string; name: string; region: Region | null }[];
  zipCoverage: {
    zip: string;
    subsidiaryId: string;
    share: number;
    status: 'sugerido' | 'confirmado' | 'excluido';
    city: string | null;
  }[];
  aliases: KnowledgeAlias[];
  knownConsolidations: { consNumber: string; subsidiaryId: string }[];
}

export interface DetectionAttachment {
  filename: string;
  kind: AttachmentKind;
  zips: Record<string, number>;
  cities: Record<string, number>;
}

export interface DetectionInput {
  subject: string;
  top: string; // mensaje superior (sin historial del hilo), texto crudo con firma
  fromAddress: string;
  ccAddresses: string[];
  attachments: DetectionAttachment[];
  consNumbers: string[];
  knowledge: Knowledge;
}

export interface DetectionResult {
  subsidiaryId: string | null;
  confidence: number;
  autoSafe: boolean;
  signals: Signal[];
  runnerUp: { subsidiaryId: string; score: number } | null;
  reason: string;
  detectorVersion: number;
}

export interface PdfPage { size: 'LETTER' | 'A4'; orientation: 'landscape' | 'portrait'; margins?: string; }

export interface PdfColumn { label: string; key: string; width?: number; align?: 'left' | 'center' | 'right'; hideWhen?: string; }

export type PdfBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'symbology'; text: string }
  | { type: 'infoGrid'; cells: { label: string; value: string }[] }
  | { type: 'statBoxes'; boxes: { label: string; value: string }[] }
  | { type: 'table'; rowsVar: string; columns: PdfColumn[]; rowClassVar?: string }
  | { type: 'signatures'; slots: { label: string }[] }
  | { type: 'footer'; text: string };

export interface PdfDoc {
  page: PdfPage;
  header?: { title: string; showDateTime?: boolean };
  blocks: PdfBlock[];
}

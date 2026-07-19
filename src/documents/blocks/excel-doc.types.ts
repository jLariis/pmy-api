export interface ExcelColumn {
  key: string;
  label: string;
  width?: number;
  numFmt?: string;
  align?: 'left' | 'center' | 'right';
}

/** Sección de una hoja heterogénea (título, espaciador, info, banda de filas fusionadas, o tabla). */
export type ExcelSection =
  | { kind: 'title'; text: string; fill?: string; font?: { size?: number; bold?: boolean; color?: string }; mergeTo: number; height?: number; when?: string }
  | { kind: 'spacer' }
  | { kind: 'info'; rows: { text: string }[]; mergeTo: number; when?: string }
  | { kind: 'band'; rowsVar: string; fill?: string; font?: { bold?: boolean; color?: string }; mergeTo: number; when?: string }
  | {
      kind: 'table';
      columns: ExcelColumn[];
      rowsVar: string;
      headerFill?: string;
      headerFont?: { bold?: boolean; color?: string };
      headerHeight?: number;
      headerAlign?: 'left' | 'center' | 'right';
      bordered?: boolean;
      cellAlign?: 'left' | 'center' | 'right';
      wrap?: boolean;
      /** Nombre del campo por fila con el argb del fill de toda la fila (null = sin fill). */
      rowFillKey?: string;
      freezeHeader?: boolean;
      autoFilter?: boolean;
      /** Si se setea y `ctx.data[when]` está "vacío" (null/undefined/''/[]), la sección se omite. */
      when?: string;
    };

export interface ExcelSheet {
  name: string;
  /** Si existe, la hoja se arma por secciones y se ignora la ruta de tabla única. */
  sections?: ExcelSection[];

  // --- Ruta de tabla única (legacy, retrocompatible) ---
  /** Título en fila 1 fusionada (admite {{var}}). */
  title?: string;
  titleFill?: string;   // argb hex (p.ej. 'ef883a')
  /** Filas de texto etiqueta:valor antes de la tabla (value admite {{var}}). */
  infoRows?: { label: string; value: string }[];
  headerFill?: string;  // argb hex del encabezado de columnas
  headerFont?: { bold?: boolean; color?: string };
  freezeHeader?: boolean;
  autoFilter?: boolean;
  columns?: ExcelColumn[];
  /** Nombre de la variable-lista con las filas (ctx.data[rowsVar]). */
  rowsVar?: string;
}

export interface ExcelDoc { sheets: ExcelSheet[]; }

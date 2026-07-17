export interface ExcelColumn {
  key: string;
  label: string;
  width?: number;
  numFmt?: string;
  align?: 'left' | 'center' | 'right';
}

export interface ExcelSheet {
  name: string;
  /** Título en fila 1 fusionada (admite {{var}}). */
  title?: string;
  titleFill?: string;   // argb hex (p.ej. 'ef883a')
  /** Filas de texto etiqueta:valor antes de la tabla (value admite {{var}}). */
  infoRows?: { label: string; value: string }[];
  headerFill?: string;  // argb hex del encabezado de columnas
  headerFont?: { bold?: boolean; color?: string };
  freezeHeader?: boolean;
  autoFilter?: boolean;
  columns: ExcelColumn[];
  /** Nombre de la variable-lista con las filas (ctx.data[rowsVar]). */
  rowsVar: string;
}

export interface ExcelDoc { sheets: ExcelSheet[]; }

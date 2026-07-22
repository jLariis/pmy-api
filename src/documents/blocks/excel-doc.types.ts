export interface ExcelColumn {
  key: string;
  label: string;
  width?: number;
  numFmt?: string;
  align?: 'left' | 'center' | 'right';
}

/** Tabla individual dentro de un `tableGroup` (ver más abajo): título + encabezado + filas de
 * datos propios, pero anclada a una columna de inicio (`startCol`) para poder convivir con
 * otra(s) tabla(s) EN LAS MISMAS FILAS (tablas "espejo" lado a lado, p.ej. C10 Devoluciones y
 * Recolecciones). */
export interface ExcelMirrorTable {
  /** Columna de inicio (1-based, A=1). */
  startCol: number;
  /** Título propio, fusionado desde `startCol` hasta el fin de sus columnas (fila propia). */
  title?: { text: string; fill?: string; font?: { bold?: boolean; color?: string } };
  columns: ExcelColumn[];
  /** Nombre de la variable-lista con las filas (ctx.data[rowsVar]). Puede ser más corta/larga que
   * la(s) otra(s) tabla(s) del grupo: se alinean por índice de fila, huecos quedan en blanco. */
  rowsVar: string;
  headerFont?: { bold?: boolean; color?: string; size?: number };
  bordered?: boolean;
  cellAlign?: 'left' | 'center' | 'right';
  /** Fill argb aplicado a TODA la fila de datos cuando el índice de fila (0-based, compartido
   * entre las tablas del grupo) es par — zebra por POSICIÓN, no por dato (fiel al frontend:
   * se aplica aunque esta tabla no tenga valor en esa fila). */
  zebraFill?: string;
  /** Campo de la fila cuyo valor truthy fuerza fuente roja+negrita (p.ej. MOTIVO con código DEX). */
  redFontKey?: string;
  redFontColor?: string;
}

/** Sección de una hoja heterogénea (título, espaciador, info, banda de filas fusionadas, fila de
 * celdas sueltas, tabla, o grupo de tablas espejo). */
export type ExcelSection =
  | { kind: 'title'; text: string; fill?: string; font?: { size?: number; bold?: boolean; color?: string }; mergeTo: number; height?: number; when?: string }
  | { kind: 'spacer' }
  | { kind: 'info'; rows: { text: string }[]; mergeTo: number; when?: string }
  | { kind: 'band'; rowsVar: string; fill?: string; font?: { bold?: boolean; color?: string; italic?: boolean }; align?: 'left' | 'center' | 'right'; mergeTo: number; when?: string }
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
    }
  /** Una sola fila con celdas en columnas arbitrarias (no necesariamente contiguas), p.ej. un
   * resumen "TOTAL A: 1   TOTAL B: 2" repartido en columnas específicas (fiel a C10, fila 5). */
  | { kind: 'row'; cells: Array<{ col: number; text?: string; key?: string; bold?: boolean }>; when?: string }
  /** Grupo de tablas "espejo" que comparten las mismas filas pero columnas distintas. */
  | { kind: 'tableGroup'; tables: ExcelMirrorTable[]; when?: string };

export interface ExcelSheet {
  name: string;
  /** Si existe, la hoja se arma por secciones y se ignora la ruta de tabla única. */
  sections?: ExcelSection[];
  /** Anchos de columna (1-based, aplicados antes de las secciones). Útil para fijar columnas
   * "espaciadoras" sin contenido propio (p.ej. D/E en una hoja con tablas espejo A:C y F:H). */
  columnWidths?: number[];

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

import { Repository } from 'typeorm';
import { DocumentTemplate } from 'src/entities/document-template.entity';
import { DocumentTemplateVersion } from 'src/entities/document-template-version.entity';
import { TemplateVariableDef } from 'src/entities/template-variable-def.entity';
import { ExcelDoc } from '../blocks/excel-doc.types';

export interface ExcelSeedVar { name: string; label: string; dataType?: string; }
export interface ExcelSeed { code: string; name: string; doc: ExcelDoc; variables: ExcelSeedVar[]; }

/** audit_log_excel — hoja "Auditoría", 11 columnas, encabezado en negrita (inventario §B9). */
const auditLog: ExcelDoc = {
  sheets: [{
    name: 'Auditoría',
    headerFont: { bold: true },
    columns: [
      { key: 'createdAt', label: 'Fecha', width: 22 },
      { key: 'userEmail', label: 'Usuario', width: 28 },
      { key: 'userName', label: 'Nombre', width: 24 },
      { key: 'role', label: 'Rol', width: 12 },
      { key: 'module', label: 'Módulo', width: 18 },
      { key: 'subsidiaryName', label: 'Sucursal', width: 22 },
      { key: 'action', label: 'Acción', width: 14 },
      { key: 'entityId', label: 'Registro', width: 26 },
      { key: 'result', label: 'Resultado', width: 12 },
      { key: 'ip', label: 'IP', width: 16 },
      { key: 'description', label: 'Descripción', width: 50 },
    ],
    rowsVar: 'rows',
  }],
};

/** route_dispatch_excel — "Salida a Ruta" rica (fiel a C2, frontend). Hoja "Despacho" por secciones. */
const routeDispatch: ExcelDoc = {
  sheets: [{
    name: 'Despacho',
    sections: [
      { kind: 'title', text: '🚚 Salida a Ruta', fill: 'ef883a', font: { size: 16, bold: true, color: 'FFFFFF' }, mergeTo: 9 },
      { kind: 'spacer' },
      { kind: 'info', mergeTo: 9, rows: [
        { text: 'Ruta: {{routeNamesArrow}}' }, { text: 'Conductores: {{driverNames}}' },
        { text: 'Unidad: {{vehicleName}}' }, { text: 'Fecha: {{dispatchDateTime}}' }, { text: 'Paquetes: {{stats.total}}' },
      ] },
      { kind: 'spacer' },
      { kind: 'band', rowsVar: 'invalidChunks', fill: 'FFE6E6', font: { bold: true, color: 'CC0000' }, mergeTo: 9, when: 'invalidChunks' },
      { kind: 'table', rowsVar: 'rows',
        headerFill: '8c5e4e', headerFont: { bold: true, color: 'FFFFFF' }, headerHeight: 20, headerAlign: 'center',
        bordered: true, cellAlign: 'center', wrap: true, rowFillKey: 'rowFill',
        columns: [
          { key: 'index', label: 'No.', width: 5 }, { key: 'trackingNumber', label: 'Guía', width: 18 },
          { key: 'recipientNameXlsx', label: 'Recibe', width: 30 }, { key: 'recipientAddressXlsx', label: 'Dirección', width: 40 },
          { key: 'recipientZip', label: 'CP', width: 10 }, { key: 'paymentXlsx', label: 'Cobro', width: 18 },
          { key: 'date', label: 'Fecha', width: 12 }, { key: 'time', label: 'Hora', width: 12 },
          { key: 'recipientPhone', label: 'Celular', width: 18 },
        ] },
    ],
  }],
};

/** unloading_excel — "Desembarque" rica (fiel a C4, frontend). Hoja "Desembarque" por secciones. */
const unloading: ExcelDoc = {
  sheets: [{
    name: 'Desembarque',
    sections: [
      { kind: 'title', text: '📦 Desembarque', fill: 'ef883a', font: { size: 16, bold: true, color: 'FFFFFF' }, mergeTo: 9 },
      { kind: 'spacer' },
      { kind: 'info', mergeTo: 9, rows: [
        { text: 'Unidad: {{vehicleName}}' }, { text: 'Fecha: {{createdDateTime}}' }, { text: 'Paquetes: {{totalPackages}}' },
      ] },
      { kind: 'spacer' },
      { kind: 'table', rowsVar: 'rows',
        headerFill: '8c5e4e', headerFont: { bold: true, color: 'FFFFFF' }, headerHeight: 20, headerAlign: 'center',
        bordered: true, cellAlign: 'center', wrap: true, rowFillKey: 'rowFill',
        columns: [
          { key: 'index', label: 'No.', width: 5 }, { key: 'trackingNumber', label: 'Guía', width: 18 },
          { key: 'recipientNameXlsx', label: 'Nombre', width: 45 }, { key: 'recipientAddressXlsx', label: 'Dirección', width: 45 },
          { key: 'recipientZip', label: 'C.P.', width: 12 }, { key: 'payment', label: 'Cobro', width: 20 },
          { key: 'date', label: 'Fecha', width: 12 }, { key: 'timeXlsx', label: 'Hora', width: 12 },
          { key: 'recipientPhone', label: 'Celular', width: 18 },
        ] },
      { kind: 'spacer' },
      { kind: 'title', text: '❌ Paquetes faltantes', fill: 'ef883a', font: { bold: true, color: 'FFFFFF' }, mergeTo: 9, when: 'missingTrackings' },
      { kind: 'band', rowsVar: 'missingTrackings', mergeTo: 9, when: 'missingTrackings' },
      { kind: 'spacer' },
      { kind: 'title', text: '📍 Guías sobrantes', fill: '8c5e4e', font: { bold: true, color: 'FFFFFF' }, mergeTo: 9, when: 'unScannedTrackings' },
      { kind: 'band', rowsVar: 'unScannedTrackings', mergeTo: 9, when: 'unScannedTrackings' },
    ],
  }],
};

/** inventory_excel — "Inventario" rica (fiel a C6, frontend). Hoja "Inventario" por secciones. */
const inventory: ExcelDoc = {
  sheets: [{
    name: 'Inventario',
    sections: [
      { kind: 'title', text: '📦 Inventario', fill: 'ef883a', font: { size: 16, bold: true, color: 'FFFFFF' }, mergeTo: 9 },
      { kind: 'spacer' },
      { kind: 'info', mergeTo: 9, rows: [
        { text: 'Sucursal: {{subsidiaryName}}' }, { text: 'Fecha: {{inventoryDateTime}}' }, { text: 'Paquetes: {{totalPackages}}' },
      ] },
      { kind: 'spacer' },
      { kind: 'table', rowsVar: 'rows',
        headerFill: '8c5e4e', headerFont: { bold: true, color: 'FFFFFF' }, headerHeight: 20, headerAlign: 'center',
        bordered: true, cellAlign: 'center', wrap: true, rowFillKey: 'rowFill',
        columns: [
          { key: 'index', label: 'No.', width: 5 }, { key: 'trackingNumber', label: 'Guía', width: 18 },
          { key: 'recipientNameXlsx', label: 'Nombre', width: 40 }, { key: 'recipientAddressXlsx', label: 'Dirección', width: 45 },
          { key: 'recipientZip', label: 'CP', width: 12 }, { key: 'payment', label: 'Cobro', width: 20 },
          { key: 'date', label: 'Fecha', width: 12 }, { key: 'timeXlsx', label: 'Hora', width: 12 },
          { key: 'recipientPhone', label: 'Celular', width: 18 },
        ] },
      { kind: 'spacer' },
      { kind: 'title', text: '❌ Missing Trackings', fill: 'ef883a', font: { bold: true, color: 'FFFFFF' }, mergeTo: 9, when: 'missingTrackings' },
      { kind: 'band', rowsVar: 'missingTrackings', mergeTo: 9, when: 'missingTrackings' },
      { kind: 'spacer' },
      { kind: 'title', text: '📍 UnScanned Trackings', fill: '8c5e4e', font: { bold: true, color: 'FFFFFF' }, mergeTo: 9, when: 'unScannedTrackings' },
      { kind: 'band', rowsVar: 'unScannedTrackings', mergeTo: 9, when: 'unScannedTrackings' },
    ],
  }],
};

/** route_closure_excel — "Cierre de Ruta" rica (fiel a C8, frontend). Hoja "Cierre de Ruta", 6 secciones. */
const routeClosure: ExcelDoc = {
  sheets: [{
    name: 'Cierre de Ruta',
    sections: [
      { kind: 'title', text: '📋 CIERRE DE RUTA', fill: '8c5e4e', font: { size: 16, bold: true, color: 'FFFFFF' }, mergeTo: 8 },
      { kind: 'spacer' },
      // (1) INFORMACIÓN GENERAL
      { kind: 'title', text: 'INFORMACIÓN GENERAL', fill: '8c5e4e', font: { bold: true, color: 'FFFFFF' }, mergeTo: 8 },
      { kind: 'table', rowsVar: 'generalInfoRows',
        headerFill: '6d4c41', headerFont: { bold: true, color: 'FFFFFF' }, headerAlign: 'center', rowFillKey: 'rowFill',
        columns: [
          { key: 'label', label: 'CAMPO', width: 22 }, { key: 'value', label: 'VALOR', width: 30, numFmt: '#,##0' },
        ] },
      { kind: 'spacer' },
      // (2) ESTADÍSTICAS
      { kind: 'title', text: 'ESTADÍSTICAS', fill: '8c5e4e', font: { bold: true, color: 'FFFFFF' }, mergeTo: 8 },
      { kind: 'table', rowsVar: 'statsRows',
        headerFill: '6d4c41', headerFont: { bold: true, color: 'FFFFFF' }, headerAlign: 'center', rowFillKey: 'rowFill',
        columns: [
          { key: 'label', label: 'ESTADÍSTICA', width: 22 }, { key: 'value', label: 'VALOR', width: 16, numFmt: '#,##0' },
        ] },
      { kind: 'spacer' },
      // (3) PAQUETES DEVUELTOS
      { kind: 'title', text: 'PAQUETES DEVUELTOS', fill: '8c5e4e', font: { bold: true, color: 'FFFFFF' }, mergeTo: 8, when: 'returnedRows' },
      { kind: 'table', rowsVar: 'returnedRows', when: 'returnedRows',
        headerFill: '6d4c41', headerFont: { bold: true, color: 'FFFFFF' }, headerAlign: 'center', rowFillKey: 'rowFill',
        columns: [
          { key: 'index', label: 'No.', width: 6 }, { key: 'trackingNumber', label: 'GUÍA', width: 18 },
          { key: 'motivoExcel', label: 'MOTIVO', width: 14 }, { key: 'recipientName', label: 'DESTINATARIO', width: 26 },
          { key: 'recipientPhone', label: 'TELÉFONO', width: 16 }, { key: 'recipientAddress', label: 'DIRECCIÓN', width: 34 },
          { key: 'date', label: 'FECHA', width: 12 }, { key: 'time', label: 'HORA', width: 12 },
        ] },
      { kind: 'band', rowsVar: 'returnedTotalRow', fill: 'E8E8E8', font: { bold: true }, mergeTo: 8, when: 'returnedRows' },
      { kind: 'spacer' },
      // (4) CONTEO POR CÓDIGO DEX
      { kind: 'title', text: 'CONTEO POR CÓDIGO DEX', fill: '8c5e4e', font: { bold: true, color: 'FFFFFF' }, mergeTo: 8 },
      { kind: 'table', rowsVar: 'dexCounts',
        headerFill: '6d4c41', headerFont: { bold: true, color: 'FFFFFF' }, headerAlign: 'center', rowFillKey: 'rowFill',
        columns: [
          { key: 'code', label: 'CÓDIGO DEX', width: 20 }, { key: 'count', label: 'CANTIDAD', width: 14, numFmt: '#,##0' },
        ] },
      { kind: 'spacer' },
      // (5) RECOLECCIONES
      { kind: 'title', text: 'RECOLECCIONES', fill: '8c5e4e', font: { bold: true, color: 'FFFFFF' }, mergeTo: 8, when: 'collections' },
      { kind: 'table', rowsVar: 'collectionRows', when: 'collections',
        headerFill: '6d4c41', headerFont: { bold: true, color: 'FFFFFF' }, headerAlign: 'center', rowFillKey: 'rowFill',
        columns: [
          { key: 'index', label: 'No.', width: 6 }, { key: 'trackingNumber', label: 'GUÍA DE RECOLECCIÓN', width: 24 },
        ] },
      { kind: 'spacer' },
      // (6) COBROS
      { kind: 'title', text: 'COBROS', fill: '8c5e4e', font: { bold: true, color: 'FFFFFF' }, mergeTo: 8, when: 'allCharges' },
      { kind: 'table', rowsVar: 'allCharges', when: 'allCharges',
        headerFill: '6d4c41', headerFont: { bold: true, color: 'FFFFFF' }, headerAlign: 'center', rowFillKey: 'rowFill',
        columns: [
          { key: 'index', label: 'No.', width: 6 }, { key: 'trackingNumber', label: 'GUÍA', width: 18 },
          { key: 'amount', label: 'MONTO', width: 14, numFmt: '"$"#,##0.00' }, { key: 'type', label: 'TIPO', width: 14 },
        ] },
    ],
  }],
};

/** returning_excel — "Devoluciones y Recolecciones" (fiel a C10, frontend). Hoja "Reporte", 8 cols
 * (A-H), tablas espejo DEVOLUCIONES (A:C) / RECOLECCIONES (F:H) en las MISMAS filas. */
const returning: ExcelDoc = {
  sheets: [{
    name: 'Reporte',
    columnWidths: [8, 25, 25, 5, 5, 25, 18, 8],
    sections: [
      { kind: 'title', text: 'FedEx - Devoluciones y Recolecciones', fill: '662D91', font: { size: 16, bold: true, color: 'FFFFFF' }, mergeTo: 8 },
      { kind: 'title', text: 'LOCALIDAD: {{subsidiaryNameUpper}}', font: { bold: true, size: 12 }, mergeTo: 8 },
      { kind: 'title', text: '{{generatedDate}}', mergeTo: 8 },
      { kind: 'spacer' },
      { kind: 'row', cells: [
        { col: 1, text: 'TOTAL RECOLECCIONES:', bold: true }, { col: 2, key: 'totalRecolecciones', bold: true },
        { col: 3, text: 'TOTAL DEVOLUCIONES:', bold: true }, { col: 4, key: 'totalDevoluciones', bold: true },
        { col: 6, text: 'TOTAL GENERAL:', bold: true }, { col: 7, key: 'totalGeneral', bold: true },
      ] },
      { kind: 'spacer' },
      { kind: 'tableGroup', tables: [
        {
          startCol: 1,
          title: { text: 'DEVOLUCIONES', fill: '662D91', font: { bold: true, color: 'FFFFFF' } },
          columns: [
            { key: 'index', label: 'No.' }, { key: 'trackingNumber', label: 'GUIA', numFmt: '@' }, { key: 'motivo', label: 'MOTIVO' },
          ],
          headerFont: { bold: true, size: 9 }, bordered: true, cellAlign: 'center', zebraFill: 'F9F9F9',
          redFontKey: 'isDex', redFontColor: 'FF0000',
          rowsVar: 'devolucionRows',
        },
        {
          startCol: 6,
          title: { text: 'RECOLECCIONES', fill: 'FF6600', font: { bold: true, color: 'FFFFFF' } },
          columns: [
            { key: 'trackingNumber', label: 'GUIA', numFmt: '@' }, { key: 'sucursal', label: 'SUCURSAL' }, { key: 'index', label: 'No.' },
          ],
          headerFont: { bold: true, size: 9 }, bordered: true, cellAlign: 'center', zebraFill: 'F9F9F9',
          rowsVar: 'recoleccionRows',
        },
      ] },
      { kind: 'spacer' },
      { kind: 'spacer' },
      { kind: 'band', rowsVar: 'dexLegend', mergeTo: 8, align: 'center', font: { italic: true } },
    ],
  }],
};

/** warehouse_dispatch_excel — Excel de bodega/salida (fiel a B2, `generateExcelBufferLegacy`
 * exceljs actual). Hoja "Despacho": título naranja + info rows + tabla 9 cols ancho 18. */
const warehouseDispatch: ExcelDoc = {
  sheets: [{
    name: 'Despacho',
    sections: [
      { kind: 'title', text: '🚚 {{title}}', fill: 'ef883a', font: { size: 16, bold: true, color: 'FFFFFF' }, mergeTo: 9 },
      { kind: 'spacer' },
      { kind: 'info', mergeTo: 9, rows: [
        { text: 'Ruta: {{rutas}}' }, { text: 'Conductores: {{conductores}}' },
        { text: 'Unidad: {{unidad}}' }, { text: 'Fecha: {{fechaDateTime}}' }, { text: 'Paquetes: {{totalPackages}}' },
      ] },
      { kind: 'spacer' },
      { kind: 'table', rowsVar: 'rows',
        headerFill: 'ef883a', headerFont: { bold: true, color: 'FFFFFF' }, headerAlign: 'center',
        columns: [
          { key: 'index', label: 'No.', width: 18 }, { key: 'trackingNumber', label: 'Guía', width: 18 },
          { key: 'recipientName', label: 'Recibe', width: 18 }, { key: 'recipientAddress', label: 'Dirección', width: 18 },
          { key: 'recipientZip', label: 'CP', width: 18 }, { key: 'payment', label: 'Cobro', width: 18 },
          { key: 'date', label: 'Fecha', width: 18 }, { key: 'recipientPhone', label: 'Teléfono', width: 18 },
          { key: 'signature', label: 'Firma', width: 18 },
        ] },
    ],
  }],
};

/** driver_report_excel — "Reporte de Choferes" con semáforo (fiel a B3, `generateDriverReportExcelLegacy`).
 * Hoja 1 "Eficiencia Operativa" (por secciones, sin cuadrícula): título + subtítulo + tabla de
 * 13 columnas con semáforo por celda (cols 12-13, `fillFromKey`) y fila de totales. Hoja 2
 * "Detalle de Paquetes": tabla simple de 9 columnas con DEX rojo (`fontColorFromKey`). */
const driverReport: ExcelDoc = {
  sheets: [
    {
      name: 'Eficiencia Operativa',
      showGridLines: false,
      sections: [
        { kind: 'title', text: '📊 REPORTE EJECUTIVO DE EFICIENCIA OPERATIVA', fill: '0F172A', font: { size: 16, bold: true, color: 'FFFFFF' }, mergeTo: 13, height: 35 },
        { kind: 'title', text: '{{periodLabel}}', font: { italic: true, color: '475569' }, mergeTo: 13 },
        { kind: 'spacer' },
        { kind: 'table', rowsVar: 'driverRows',
          headerFill: '2563EB', headerFont: { bold: true, color: 'FFFFFF' }, headerHeight: 25, headerAlign: 'center',
          headerBorder: { style: 'medium', color: '1E3A8A' },
          lastRowBorder: { style: 'double', color: '94A3B8' },
          rowFillKey: 'rowFill', cellAlign: 'center', autoFilter: true,
          columns: [
            { key: 'driverName', label: 'Chofer / Repartidor', width: 32, align: 'left' },
            { key: 'total', label: 'Total Asignados', width: 15, numFmt: '#,##0' },
            { key: 'delivered', label: 'Entregados', width: 14, numFmt: '#,##0' },
            { key: 'returned', label: 'DEX Total', width: 12, numFmt: '#,##0' },
            { key: 'dex03', label: 'DEX 03 (Dir. Mal)', width: 15, numFmt: '#,##0' },
            { key: 'dex07', label: 'DEX 07 (Rechazo)', width: 16, numFmt: '#,##0' },
            { key: 'dex08', label: 'DEX 08 (No Disp.)', width: 16, numFmt: '#,##0' },
            { key: 'pending', label: 'Sin Movimiento', width: 15, numFmt: '#,##0' },
            { key: 'fechaReq', label: 'Cambio Fecha', width: 15, numFmt: '#,##0' },
            { key: 'retFdx', label: 'Dev. FedEx', width: 15, numFmt: '#,##0' },
            { key: 'unmapped', label: 'Otros (Fugas)', width: 15, numFmt: '#,##0' },
            { key: 'pctEff', label: '% Efectividad', width: 14, numFmt: '0.0%', fillFromKey: 'pctEffFill' },
            { key: 'pctRet', label: '% Retorno', width: 12, numFmt: '0.0%', fillFromKey: 'pctRetFill' },
          ] },
      ],
    },
    {
      name: 'Detalle de Paquetes',
      showGridLines: false,
      sections: [
        { kind: 'table', rowsVar: 'detailRows',
          headerFill: '475569', headerFont: { bold: true, color: 'FFFFFF' }, headerHeight: 25, headerAlign: 'center',
          rowFillKey: 'rowFill', autoFilter: true,
          columns: [
            { key: 'driver', label: 'Chofer', width: 25 },
            { key: 'route', label: 'Ruta', width: 20 },
            { key: 'subsidiary', label: 'Sucursal', width: 20 },
            { key: 'tracking', label: 'Tracking', width: 22, align: 'center' },
            { key: 'status', label: 'Estatus', width: 35, align: 'center' },
            { key: 'dex', label: 'Cód. DEX', width: 14, align: 'center', fontColorFromKey: 'dexColor' },
            { key: 'commit', label: 'Fecha Commit', width: 18, align: 'center' },
            { key: 'cp', label: 'C.P.', width: 10, align: 'center' },
            { key: 'recipient', label: 'Destinatario', width: 35 },
          ] },
      ],
    },
  ],
};

export const EXCEL_TEMPLATE_SEEDS: ExcelSeed[] = [
  { code: 'route_dispatch_excel', name: 'Salida a Ruta (Excel)', doc: routeDispatch,
    variables: [
      { name: 'routeNamesArrow', label: 'Rutas' }, { name: 'driverNames', label: 'Conductores' },
      { name: 'vehicleName', label: 'Unidad' }, { name: 'dispatchDateTime', label: 'Fecha' },
      { name: 'stats', label: 'Métricas' }, { name: 'invalidChunks', label: 'Guías inválidas' }, { name: 'rows', label: 'Filas' },
    ] },
  { code: 'audit_log_excel', name: 'Auditoría (Excel)', doc: auditLog,
    variables: [{ name: 'rows', label: 'Filas de auditoría (createdAt ya formateado es-MX en código)' }] },
  { code: 'unloading_excel', name: 'Desembarque (Excel)', doc: unloading,
    variables: [
      { name: 'vehicleName', label: 'Unidad' }, { name: 'createdDateTime', label: 'Fecha' },
      { name: 'totalPackages', label: 'Total de paquetes', dataType: 'number' }, { name: 'rows', label: 'Filas' },
      { name: 'missingTrackings', label: 'Guías faltantes' }, { name: 'unScannedTrackings', label: 'Guías sobrantes' },
    ] },
  { code: 'inventory_excel', name: 'Inventario (Excel)', doc: inventory,
    variables: [
      { name: 'subsidiaryName', label: 'Sucursal' }, { name: 'inventoryDateTime', label: 'Fecha' },
      { name: 'totalPackages', label: 'Total de paquetes', dataType: 'number' }, { name: 'rows', label: 'Filas' },
      { name: 'missingTrackings', label: 'Guías faltantes' }, { name: 'unScannedTrackings', label: 'Guías sin escaneo' },
    ] },
  { code: 'route_closure_excel', name: 'Cierre de Ruta (Excel)', doc: routeClosure,
    variables: [
      { name: 'generalInfoRows', label: 'Información general (sucursal/unidad/conductor/rutas/km/fechas)' },
      { name: 'statsRows', label: 'Estadísticas' },
      { name: 'returnedRows', label: 'Paquetes devueltos' }, { name: 'returnedTotalRow', label: 'Total de devoluciones (banda)' },
      { name: 'dexCounts', label: 'Conteo por código DEX' },
      { name: 'collectionRows', label: 'Recolecciones (+ total)' },
      { name: 'allCharges', label: 'Cobros de todo el despacho (+ total)' },
    ] },
  { code: 'warehouse_dispatch_excel', name: 'Salida a Ruta / Bodega (Excel)', doc: warehouseDispatch,
    variables: [
      { name: 'title', label: 'Título' }, { name: 'rutas', label: 'Rutas (unidas con ->)' },
      { name: 'conductores', label: 'Conductores (unidos con -)' }, { name: 'unidad', label: 'Unidad' },
      { name: 'fechaDateTime', label: 'Fecha (yyyy-MM-dd HH:mm)' },
      { name: 'totalPackages', label: 'Total de paquetes', dataType: 'number' }, { name: 'rows', label: 'Filas' },
    ] },
  { code: 'returning_excel', name: 'Devoluciones y Recolecciones (Excel)', doc: returning,
    variables: [
      { name: 'subsidiaryNameUpper', label: 'Sucursal (mayúsculas)' }, { name: 'generatedDate', label: 'Fecha de generación' },
      { name: 'totalDevoluciones', label: 'Total devoluciones', dataType: 'number' },
      { name: 'totalRecolecciones', label: 'Total recolecciones', dataType: 'number' },
      { name: 'totalGeneral', label: 'Total general', dataType: 'number' },
      { name: 'devolucionRows', label: 'Filas de devoluciones (No./GUIA/MOTIVO)' },
      { name: 'recoleccionRows', label: 'Filas de recolecciones (GUIA/SUCURSAL/No.)' },
      { name: 'dexLegend', label: 'Leyenda DEX 03/07/08/17' },
    ] },
  { code: 'driver_report_excel', name: 'Reporte de Choferes (Excel)', doc: driverReport,
    variables: [
      { name: 'periodLabel', label: 'Periodo analizado (ya formateado)' },
      { name: 'driverRows', label: 'Filas por chofer + fila TOTALES GLOBALES (semáforo pctEffFill/pctRetFill)' },
      { name: 'detailRows', label: 'Detalle de paquetes (hoja 2, dexColor si hay código DEX)' },
    ] },
];

interface SeedRepos { tplRepo: Repository<DocumentTemplate>; verRepo: Repository<DocumentTemplateVersion>; varRepo: Repository<TemplateVariableDef>; }

export async function seedExcelTemplates(repos: SeedRepos): Promise<void> {
  for (const seed of EXCEL_TEMPLATE_SEEDS) {
    let template = await repos.tplRepo.findOne({ where: { code: seed.code } });
    if (!template) template = await repos.tplRepo.save(repos.tplRepo.create({ code: seed.code, name: seed.name, type: 'excel', language: 'es', active: true, category: 'reporte' }));
    let version = await repos.verRepo.findOne({ where: { templateId: template.id, version: 1 } });
    if (!version) version = await repos.verRepo.save(repos.verRepo.create({ templateId: template.id, version: 1, status: 'published', subject: null, designJson: seed.doc, compiledBody: null, engine: 'handlebars', changelog: 'Seed inicial Excel (fiel a exceljs legacy)', publishedAt: new Date() }));
    if (!template.currentVersionId) { template.currentVersionId = version.id; await repos.tplRepo.save(template); }
    const existing = await repos.varRepo.find({ where: { templateId: template.id } });
    if (existing.length === 0) await repos.varRepo.save(seed.variables.map((v) => repos.varRepo.create({ templateId: template.id, name: v.name, label: v.label, dataType: (v.dataType as any) ?? 'string', example: null, required: false })));
  }
}

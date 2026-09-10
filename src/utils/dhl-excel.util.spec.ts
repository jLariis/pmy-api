import * as XLSX from 'xlsx';
import {
  combineDhlWorkbook,
  combinedToDhlShipmentDto,
  isThreeSheetDhlWorkbook,
  toIsoDate,
} from './dhl-excel.util';

/** Arma un workbook estilo export DHL (hojas Shipment/Piece/Event). */
function buildWorkbook(opts?: {
  shipment?: any[][];
  piece?: any[][];
  includeShipment?: boolean;
}): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  const shipment = opts?.shipment ?? [
    ['HWB No', 'Rcvr Addr 1', 'Rcvr Addr 2', 'Rcvr Postcode', 'EDD', 'Last Event Cd'],
    ['8303176685', 'Calle Jesus Garcia', 'Campo 5', '85207', new Date(2026, 8, 14), 'FD'],
    ['1110251015', 'Av. Central 100', '', '85000', new Date(2026, 8, 15), 'FD'],
  ];

  const piece = opts?.piece ?? [
    ['HWB No', 'Piece ID', 'Receiver Name', 'Value', 'Piece Weight', 'Clock Start', 'EDD', 'Description'],
    ['8303176685', 'JD0081109268303176685', 'FELICITAS VEGA', 258.61, 0.26, new Date(2026, 8, 7), new Date(2026, 8, 14), 'Audifonos'],
    ['1110251015', 'JD014600012810254440', 'JUAN PEREZ', 100, 1.2, new Date(2026, 8, 8), new Date(2026, 8, 15), 'Cable'],
    // Pieza cuya guía NO está en la hoja Shipment (incompleta):
    ['9999999999', 'JD000000000000000001', 'SIN DIRECCION', 50, 0.5, new Date(2026, 8, 9), new Date(2026, 8, 16), 'Otro'],
  ];

  const event = [
    ['HWB No', 'Piece ID', 'Event Cd', 'Event Dtm'],
    ['8303176685', 'JD0081109268303176685', 'IA', new Date(2026, 8, 7)],
  ];

  if (opts?.includeShipment !== false) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(shipment), 'Shipment');
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(piece), 'Piece');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(event), 'Event');
  return wb;
}

describe('dhl-excel.util', () => {
  describe('toIsoDate', () => {
    it('convierte Date a yyyy-MM-dd', () => {
      expect(toIsoDate(new Date(2026, 8, 14))).toBe('2026-09-14');
    });
    it('convierte formato US MM/DD/YYYY', () => {
      expect(toIsoDate('09/14/2026')).toBe('2026-09-14');
    });
    it('convierte ISO yyyy-MM-dd', () => {
      expect(toIsoDate('2026-09-14')).toBe('2026-09-14');
    });
    it('regresa null para vacío', () => {
      expect(toIsoDate('')).toBeNull();
      expect(toIsoDate(null)).toBeNull();
    });
  });

  describe('isThreeSheetDhlWorkbook', () => {
    it('detecta el export de 3 hojas por contenido', () => {
      expect(isThreeSheetDhlWorkbook(buildWorkbook())).toBe(true);
    });
    it('es falso si no hay hoja Shipment (dirección/CP)', () => {
      expect(isThreeSheetDhlWorkbook(buildWorkbook({ includeShipment: false }))).toBe(false);
    });
    it('es falso para un libro plano sin Piece ID', () => {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([['HWB No', 'Nombre', 'Dirección']]),
        'Hoja1',
      );
      expect(isThreeSheetDhlWorkbook(wb)).toBe(false);
    });
  });

  describe('combineDhlWorkbook', () => {
    it('usa Piece como base (una fila por PID)', () => {
      const rows = combineDhlWorkbook(buildWorkbook());
      expect(rows).toHaveLength(3);
      expect(rows.map((r) => r.dhlUniqueId).sort()).toEqual([
        'JD0081109268303176685',
        'JD000000000000000001',
        'JD014600012810254440',
      ].sort());
    });

    it('ordena por trackingNumber (guía master), numérico', () => {
      const rows = combineDhlWorkbook(buildWorkbook());
      expect(rows.map((r) => r.trackingNumber)).toEqual(['1110251015', '8303176685', '9999999999']);
    });

    it('enriquece dirección/CP y vencimiento REAL desde Shipment por guía', () => {
      const rows = combineDhlWorkbook(buildWorkbook());
      const r0 = rows.find((r) => r.trackingNumber === '8303176685')!;
      expect(r0.recipientName).toBe('FELICITAS VEGA');
      expect(r0.recipientAddress).toBe('Calle Jesus Garcia, Campo 5');
      expect(r0.recipientZip).toBe('85207');
      expect(r0.commitDate).toBe('2026-09-14'); // EDD de Shipment
      expect(r0.incomplete).toBe(false);
      expect(r0.declaredValue).toBe(258.61);
    });

    it('NO toma la hoja Event como base aunque venga antes que Piece', () => {
      // La hoja Event trae HWB No + Piece ID y MUCHAS filas (una por evento).
      // Si el orden pone Event antes que Piece, no debe ganar como base.
      const wb = buildWorkbook();
      const eventHeavy = XLSX.utils.aoa_to_sheet([
        ['HWB No', 'Piece ID', 'Event Cd', 'Event Dtm'],
        ...Array.from({ length: 50 }, (_, i) => ['8303176685', 'JD0081109268303176685', 'DF', new Date(2026, 8, 8, i % 24)]),
      ]);
      const reordered: XLSX.WorkBook = {
        SheetNames: ['Shipment', 'EventFirst', 'Piece'],
        Sheets: { Shipment: wb.Sheets['Shipment'], EventFirst: eventHeavy, Piece: wb.Sheets['Piece'] },
      } as any;
      const rows = combineDhlWorkbook(reordered);
      expect(rows).toHaveLength(3); // 3 piezas de la hoja Piece, NO las 50 de Event
    });

    it('marca incompleta y usa EDD de la pieza cuando la guía no está en Shipment', () => {
      const rows = combineDhlWorkbook(buildWorkbook());
      const orphan = rows.find((r) => r.trackingNumber === '9999999999');
      expect(orphan).toBeDefined();
      expect(orphan!.incomplete).toBe(true);
      expect(orphan!.recipientAddress).toBe('');
      expect(orphan!.recipientZip).toBe('');
      expect(orphan!.commitDate).toBe('2026-09-16'); // respaldo: EDD de la pieza
    });
  });

  describe('combinedToDhlShipmentDto', () => {
    it('mapea al shape del preview con dueDate', () => {
      const dtos = combinedToDhlShipmentDto(combineDhlWorkbook(buildWorkbook()));
      const d0 = dtos.find((d) => d.awb === '8303176685')!;
      expect(d0.awb).toBe('8303176685');
      expect(d0.pid).toBe('JD0081109268303176685');
      expect(d0.receiver.name).toBe('FELICITAS VEGA');
      expect(d0.receiver.address1).toBe('Calle Jesus Garcia, Campo 5');
      expect(d0.receiver.zip).toBe('85207');
      expect(d0.dueDate).toBe('2026-09-14');
      expect(d0.pieces).toBe(1);
    });
  });
});

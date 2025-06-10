import * as XLSX from 'xlsx';
import { ShipmentStatusType } from '../common/enums/shipment-status-type.enum';
import { getHeaderIndexMap } from './header-detector.util';
import { ParsedShipmentDto } from 'src/shipments/dto/parsed-shipment.dto';
import { Priority } from 'src/common/enums/priority.enum';
import { Payment } from 'src/entities/payment.entity';
import { PaymentStatus } from 'src/common/enums/payment-status.enum';

const todayISO = new Date().toISOString();

interface ParseOptions {
    fileName: string;
}

export function getPriority(commitDate: Date): Priority {
    if(!commitDate) return null;

    const diff = (commitDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24);
    if (diff <= 0) return Priority.ALTA;
    if (diff <= 3) return Priority.MEDIA;
    return Priority.BAJA;
}

function formatExcelDateToMySQL(dateStr?: string): string | null {
    if (!dateStr || typeof dateStr !== 'string') return null;
    const parts = dateStr.split('/');
    if (parts.length !== 3) return null;
    const [month, day, year] = parts;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function excelDateToJSDate(serial: number): Date {
  const utcDays = Math.floor(serial - 25569); // días desde Unix epoch
  const utcValue = utcDays * 86400; // segundos
  const dateInfo = new Date(utcValue * 1000);

  // Esto preserva la hora local
  const fractionalDay = serial - Math.floor(serial) + 0.0000001;

  let totalSeconds = Math.floor(86400 * fractionalDay);
  const seconds = totalSeconds % 60;
  totalSeconds = Math.floor(totalSeconds / 60);
  const minutes = totalSeconds % 60;
  const hours = Math.floor(totalSeconds / 60);

  dateInfo.setHours(hours);
  dateInfo.setMinutes(minutes);
  dateInfo.setSeconds(seconds);

  return dateInfo;
}

function normalizeDateInput(input: any): Date {
  if (typeof input === 'number') {
    return excelDateToJSDate(input);
  }
  if (typeof input === 'string') {
    // Asume ISO, convierte a local correctamente
    const date = new Date(input);
    return new Date(date.getTime() + date.getTimezoneOffset() * 60000); // para obtener hora local sin desfase
  }
  if (input instanceof Date) {
    return new Date(input.getTime() + input.getTimezoneOffset() * 60000);
  }
  throw new Error('Formato de fecha no reconocido');
}

function formatExcelTimeToMySQL(timeStr?: string): string {
    if (!timeStr || typeof timeStr !== 'string') {
        return new Date().toTimeString().slice(0, 8);
    }
    const timeRegex = /^\d{2}:\d{2}(:\d{2})?$/;
    if (timeRegex.test(timeStr.trim())) {
        return timeStr.trim().length === 5 ? `${timeStr.trim()}:00` : timeStr.trim();
    }
    return new Date().toTimeString().slice(0, 8);
}

function parseExcelDate(value: any): string | null {
  if (!value) return null;

  let d: Date | null = null;

  if (value instanceof Date) {
    d = new Date(value.getTime() + (value.getTimezoneOffset() * 60000)); // Ajuste a local
  } else if (typeof value === 'number') {
    // Excel serial date: desde 1899-12-30
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    d = new Date(excelEpoch.getTime() + value * 86400000);
  } else if (typeof value === 'string') {
    const parts = value.split('/');
    if (parts.length === 3) {
      const [a, b, c] = parts.map(p => parseInt(p, 10));
      const isUS = a <= 12 && b <= 31;
      const year  = c;
      const month = (isUS ? a : b) - 1;
      const day   = isUS ? b : a;
      d = new Date(year, month, day);
    }
  }

  if (!d || isNaN(d.getTime())) return null;

  // Regresamos como yyyy-MM-dd (más estándar)
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseDynamicSheet(sheet: XLSX.Sheet, options: ParseOptions): ParsedShipmentDto[] {
    const { fileName } = options;

    const isYaqui = fileName.toLowerCase().includes('yaqui');
    const is315 = fileName.toLowerCase().includes('31.5');
    
    const allRows: any[][] = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        range: 0,
        blankrows: false
    });

    const { map: headerMap, headerRowIndex } = getHeaderIndexMap(sheet);
    const dataRows = allRows.slice(headerRowIndex + 1);

    return dataRows.map(row => {
        const rawDate = row[headerMap['commitDate']];
        const commitDate = formatExcelDateToMySQL(rawDate) ?? null;
        
        console.log("🚀 ~ parseDynamicSheet ~ commitDate:", commitDate)

        const recipientCity = isYaqui ? 'Del Yaqui' : (row[headerMap['recipientCity']] ?? 'N/A');
        const payment = row[headerMap['payment']] ?? null;

        return {
            trackingNumber: row[headerMap['trackingNumber']],
            recipientName: row[headerMap['recipientName']] ?? 'Sin Nombre',
            recipientAddress: row[headerMap['recipientAddress']] ?? 'Sin Dirección',
            recipientCity,
            recipientZip: row[headerMap['recipientZip']] ?? 'N/A',
            commitDate: commitDate, // ISO format string o null
            commitTime: formatExcelTimeToMySQL(row[headerMap['commitTime']]),
            recipientPhone: row[headerMap['recipientPhone']] ?? 'Sin Teléfono',
            payment,
            //priority: getPriority(priorityDate),
            consNumber: row[headerMap['consNumber']] ?? null,
            isNotIndividualBilling: is315, // si es true es carga completa si es false es normal
        };
    });
}

export function parseDynamicSheetCharge(sheet: XLSX.Sheet) {
    const shipmentsWithCharge = [];    
    const allRows: any[][] = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        range: 0,
        blankrows: false
    });

    const { map: headerMap, headerRowIndex } = getHeaderIndexMap(sheet,20, true);
    
    console.log("🚀 ~ parseDynamicSheetCharge ~ headerMap:", headerMap)

    const dataRows = allRows.slice(headerRowIndex + 1);

    dataRows.map(row => {
        const includesCharge = row[headerMap['cod']]

        if(includesCharge) {
            console.log("Incluye cobro");

            const newPayment: Payment = new Payment();
            const match = includesCharge.match(/([0-9]+(?:\.[0-9]+)?)/);

            if(match) {
                const amount = parseFloat(match[1]);
                
                if(!isNaN(amount)) {
                    newPayment.amount = amount;
                    newPayment.status = PaymentStatus.PENDING
                }
            }

            shipmentsWithCharge.push({
                trackingNumber: row[headerMap['trackingNumber']],
                recipientAddress: row[headerMap['recipientAddress']],
                payment: newPayment,
            })                    
        }
    });

    return shipmentsWithCharge;
}

export function parseDynamicSheetDHL(sheet: XLSX.Sheet) {
    const allRows: any[][] = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        range: 0,
        blankrows: false,
        raw: false
    });

    const { map: headerMap, headerRowIndex } = getHeaderIndexMap(sheet,20, true);
    
    console.log("🚀 ~ parseDynamicSheetCharge ~ headerMap:", headerMap)

    const dataRows = allRows.slice(headerRowIndex + 1);

    return dataRows.map(row => {
        console.log("🚀 ~ parseDynamicSheetDHL ~ row:", row)

        return {
            trackingNumber: row[headerMap['trackingNumber']],
            recipientAddress: row[headerMap['recipientAddress']],
            recipientAddress2: row[headerMap['recipientAddress2']],
            recipientZip: row[headerMap['recipientZip']],
            commitDate: row[headerMap['commitDate']]
        }
    });
}


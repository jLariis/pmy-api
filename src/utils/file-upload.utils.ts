import * as XLSX from 'xlsx';
import { getHeaderIndexMap } from './header-detector.util';
import { ParsedShipmentDto } from 'src/shipments/dto/parsed-shipment.dto';
import { Priority } from 'src/common/enums/priority.enum';
import { Payment } from 'src/entities/payment.entity';
import { PaymentStatus } from 'src/common/enums/payment-status.enum';

interface ParseOptions {
    fileName: string;
    sheetName?: string;
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

export function parseDynamicSheet(sheet: XLSX.Sheet, options: ParseOptions): ParsedShipmentDto[] {
    const { fileName } = options;

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
        const recipientCity = row[headerMap['recipientCity']] ?? null;
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
            consNumber: row[headerMap['consNumber']] ?? null,
            isPartOfCharge: is315, // si es true es carga completa si es false es normal
        };
    });
}

export function parseDynamicFileF2(sheet: XLSX.Sheet) {    
    const allRows: any[][] = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        range: 0,
        blankrows: false
    });

    const { map: headerMap, headerRowIndex } = getHeaderIndexMap(sheet);
    const dataRows = allRows.slice(headerRowIndex + 1);

    return dataRows.map(row => {
        return {
            trackingNumber: row[headerMap['trackingNumber']],
            recipientName: row[headerMap['recipientName']] ?? 'Sin Nombre',
            recipientAddress: row[headerMap['recipientAddress']] ?? 'Sin Dirección',
            recipientZip: row[headerMap['recipientZip']] ?? 'N/A',
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

export function parseDynamicHighValue(sheet: XLSX.Sheet) {
    const highValueShipments = [];    
    const allRows: any[][] = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        range: 0,
        blankrows: false
    });

    const { map: headerMap, headerRowIndex } = getHeaderIndexMap(sheet,20, true);
    
    console.log("🚀 ~ parseHighValueShipments ~ headerMap:", headerMap)

    const dataRows = allRows.slice(headerRowIndex + 1);

    dataRows.map(row => {
        highValueShipments.push({
            trackingNumber: row[headerMap['trackingNumber']],
            recipientAddress: row[headerMap['recipientAddress']],
        });
    });

    return highValueShipments;
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


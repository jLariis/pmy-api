import * as XLSX from 'xlsx';
import { ShipmentStatusType } from '../common/enums/shipment-status-type.enum';
import { getHeaderIndexMap } from './header-detector.util';
import { ParsedShipmentDto } from 'src/shipments/dto/parsed-shipment.dto';
import { Priority } from 'src/common/enums/priority.enum';

const todayISO = new Date().toISOString();

interface ParseOptions {
    fileName: string;
}

function getPriority(commitDate: Date): Priority {
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

export function parseDynamicSheet(sheet: XLSX.Sheet,  options: ParseOptions): ParsedShipmentDto[] {
    const { fileName } = options;

    const isYaqui = fileName.toLowerCase().includes('yaqui');
    const is315 = fileName.toLowerCase().includes('31.5');
    
    const allRows: any[][] = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        range: 0,
        blankrows: false,
    });

    const { map: headerMap, headerRowIndex } = getHeaderIndexMap(sheet);

    const dataRows = allRows.slice(headerRowIndex + 1);

    return dataRows.map(row => {
        const rawDate = row[headerMap['commitDate']];
        const commitDate = formatExcelDateToMySQL(rawDate) ?? new Date().toISOString().slice(0, 10);
        const priorityDate = commitDate ? new Date(commitDate) : new Date();
        const recipientCity = isYaqui ? 'Del Yaqui' : (row[headerMap['recipientCity']] ?? 'N/A');
        const payment = row[headerMap['payment']] ?? null;

        console.log("🚀 ~ parseDynamicSheet ~ payment:", payment);

        return {
            trackingNumber: row[headerMap['trackingNumber']],
            recipientName: row[headerMap['recipientName']] ?? 'Sin Nombre',
            recipientAddress: row[headerMap['recipientAddress']] ?? 'Sin Dirección',
            recipientCity,
            recipientZip: row[headerMap['recipientZip']] ?? 'N/A',
            commitDate: commitDate,
            commitTime: formatExcelTimeToMySQL(row[headerMap['commitTime']]),
            recipientPhone: row[headerMap['recipientPhone']] ?? 'Sin Teléfono',
            payment,
            priority: getPriority(priorityDate),
            consNumber: row[headerMap['consNumber']] ?? null,
        };
    });
}

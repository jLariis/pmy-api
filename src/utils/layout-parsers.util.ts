import * as XLSX from 'xlsx';
import { ShipmentStatusType } from '../common/enums/shipment-status-type.enum';
import { LayoutType } from './file-detector.util';
import { PaymentStatus } from 'src/common/enums/payment-status.enum';

const todayISO = new Date().toISOString();

function getPriority(commitDate: Date): 'alta' | 'media' | 'baja' {
    const diff = (commitDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24);
    if (diff <= 0) return 'alta';
    if (diff <= 3) return 'media';
    return 'baja';
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

export function parseByLayout(sheet: XLSX.Sheet, type: LayoutType, isCSV: boolean): any[] {
    // Define el rango dinámicamente según el layout
    const startRowByLayout: Record<LayoutType, number> = {
        YAQUI_LOCAL: 1,
        BASIC: 1,
        LONG: 1,
        OPAR: 6, // fila 6 (índice 5)
        CABORCA: 1,
        YAQUI_2: 1,
    };

    const startRow = startRowByLayout[type] ?? 1;

    const jsonData: any[][] = XLSX.utils.sheet_to_json(sheet, {
        range: startRow,
        header: 1,
        blankrows: false,
    });

    switch (type) {
        case 'YAQUI_LOCAL':
            console.log('YAQUI_LOCAL');
            return jsonData.map(row => { 
                const rawDate = row[4];
                const formattedDate = formatExcelDateToMySQL(rawDate);
                const commitDate = formattedDate ?? new Date().toISOString().slice(0, 10);
                const priorityDate = formattedDate ? new Date(commitDate) : new Date();
                
                return {
                    trackingNumber: row[0],
                    recipientName: row[2] ?? row[1],
                    recipientAddress: row[3],
                    recipientCity: 'Del Yaqui', // o CD OBREGON
                    recipientZip: 'N/A',
                    commitDate: commitDate,
                    commitTime: formatExcelTimeToMySQL(row[10]),
                    recipientPhone: row[5],
                    status: ShipmentStatusType.PENDIENTE,
                    payment: null,
                    priority: getPriority(priorityDate),
                    statusHistory: [{
                        status: ShipmentStatusType.RECOLECCION,
                        timestamp: todayISO,
                        notes: 'Paquete recogido en sucursal',
                    }],
                    consNumber: null,
                }
            });

        case 'YAQUI_2':
            console.log('YAQUI_2');
            return jsonData.map(row => { 
                const rawDate = row[4];
                const formattedDate = formatExcelDateToMySQL(rawDate);
                const commitDate = formattedDate ?? new Date().toISOString().slice(0, 10);
                const priorityDate = formattedDate ? new Date(commitDate) : new Date();
                
                return {
                    trackingNumber: row[0],
                    recipientName: row[1] ?? 'Sin Nombre',
                    recipientAddress: row[2] ?? 'Sin Dirección',
                    recipientCity: 'Del Yaqui', // o CD OBREGON
                    recipientZip: row[3],
                    commitDate: commitDate,
                    commitTime: formatExcelTimeToMySQL(row[5]),
                    recipientPhone: row[6] ?? 'Sin Teléfono',
                    status: ShipmentStatusType.PENDIENTE,
                    payment: null,
                    priority: getPriority(priorityDate),
                    statusHistory: [{
                        status: ShipmentStatusType.RECOLECCION,
                        timestamp: todayISO,
                        notes: 'Paquete recogido en sucursal',
                    }],
                    consNumber: null,
                }
            });

        case 'BASIC':
            console.log('BASIC');
            return jsonData.map(row => {
                const rawDate = row[20];
                const formattedDate = formatExcelDateToMySQL(rawDate);
                const commitDate = formattedDate ?? new Date().toISOString().slice(0, 10);
                const priorityDate = formattedDate ? new Date(commitDate) : new Date();

                return {
                    trackingNumber: row[0],
                    recipientName: row[13],
                    recipientAddress: row[14],
                    recipientCity: row[15],
                    recipientZip: row[18],
                    commitDate,
                    commitTime: formatExcelTimeToMySQL(row[21]),
                    recipientPhone: row[23],
                    status: ShipmentStatusType.PENDIENTE,
                    payment: null,
                    priority: getPriority(priorityDate),
                    statusHistory: [{
                        status: ShipmentStatusType.RECOLECCION,
                        timestamp: todayISO,
                        notes: 'Paquete recogido en sucursal',
                    }],
                    consNumber: null,
                };
            });

        case 'LONG':
        case 'OPAR':
            console.log('LONG, OPAR');
            return jsonData.map(row => {
                const rawDate = row[20];
                const formattedDate = formatExcelDateToMySQL(rawDate);
                const commitDate = formattedDate ?? new Date().toISOString().slice(0, 10);
                const priorityDate = formattedDate ? new Date(commitDate) : new Date();

                return {
                    trackingNumber: row[0],
                    recipientName: row[13],
                    recipientAddress: row[14],
                    recipientCity: row[15],
                    recipientZip: row[18],
                    commitDate: commitDate,
                    commitTime: formatExcelTimeToMySQL(row[21]),
                    recipientPhone: row[23],
                    status: ShipmentStatusType.PENDIENTE,
                    payment: null,
                    priority: getPriority(priorityDate),
                    statusHistory: [{
                        status: ShipmentStatusType.RECOLECCION,
                        timestamp: todayISO,
                        notes: 'Paquete recogido en sucursal',
                    }],
                    consNumber: row[0],
                };
            });

        case 'CABORCA':
        console.log('CABORCA');
        return jsonData.map(row => {
            const rawDate = row[5];
            const formattedDate = formatExcelDateToMySQL(rawDate);
            const commitDate = formattedDate ?? new Date().toISOString().slice(0, 10);
            const priorityDate = formattedDate ? new Date(commitDate) : new Date();

            // Extraer monto desde row[8]
            const rawPayment = row[8];
            let payment = null;

            if (typeof rawPayment === 'string') {
            const match = rawPayment.match(/([0-9]+(?:\.[0-9]+)?)/);
            if (match) {
                const amount = parseFloat(match[1]);
                if (!isNaN(amount)) {
                payment = {
                    amount,
                    status: PaymentStatus.PENDING
                };
                }
            }
            }

            console.log("🚀 ~ parseByLayout ~ row:", row);

            return {
                trackingNumber: row[0],
                recipientName: row[1],
                recipientAddress: row[2],
                recipientCity: row[3],
                recipientZip: row[4],
                commitDate: commitDate,
                commitTime: formatExcelTimeToMySQL(row[10]),
                recipientPhone: row[6],
                status: ShipmentStatusType.PENDIENTE,
                payment: payment,
                priority: getPriority(priorityDate),
                statusHistory: [{
                    status: ShipmentStatusType.RECOLECCION,
                    timestamp: todayISO,
                    notes: 'Paquete recogido en sucursal',
                }],
                consNumber: null,
                };
            });
        default:
            console.warn('Layout no reconocido o nulo');
            return [];
    }
}

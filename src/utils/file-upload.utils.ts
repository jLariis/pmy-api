import * as XLSX from 'xlsx';
import { getHeaderIndexMap } from './header-detector.util';
import { ParsedShipmentDto } from 'src/shipments/dto/parsed-shipment.dto';
import { Priority } from 'src/common/enums/priority.enum';
import { Payment } from 'src/entities/payment.entity';
import { PaymentStatus } from 'src/common/enums/payment-status.enum';
import { PaymentTypeEnum } from 'src/common/enums/payment-type.enum';

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
  if (!timeStr) {
    return '18:00:00'; // valor por defecto si no viene nada
  }

  const timeNumber = typeof timeStr === 'string' ? parseFloat(timeStr) : timeStr;

  // Si no es un número válido, regresa 18:00:00
  if (isNaN(timeNumber)) {
    return '18:00:00';
  }

  // Convierte el número de Excel a milisegundos desde el inicio del día
  const totalSeconds = Math.round(timeNumber * 86400);
  const hours = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
  const minutes = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');

  return `${hours}:${minutes}:${seconds}`;
}

/**
 * Devuelve la PRIMERA hoja del libro cuyos encabezados se reconocen. Evita el
 * bug de leer siempre `SheetNames[0]` cuando el Excel trae 2+ páginas (portada,
 * resumen, etc.) y los datos están en otra hoja.
 */
export function pickSheetWithHeaders(workbook: XLSX.WorkBook, isForCharges = false): { sheet: XLSX.Sheet; sheetName: string } {
    const names = workbook.SheetNames || [];
    const problems: string[] = [];
    // Se prueba EN ORDEN (normalmente la hoja 0 es la de datos). Se EXIGE la
    // columna de guía (trackingNumber); las hojas sin ella se SALTAN en vez de
    // tronar — así un archivo con hojas extra (resumen, etc.) no rompe el proceso.
    for (const name of names) {
        const sheet = workbook.Sheets[name];
        try {
            const { map } = getHeaderIndexMap(sheet, 10, isForCharges);
            if (map.trackingNumber === undefined) {
                problems.push(`"${name}" (sin columna de Guía/Tracking)`);
                continue;
            }
            return { sheet, sheetName: name };
        } catch {
            problems.push(`"${name}" (sin encabezados reconocidos)`);
            continue;
        }
    }
    throw new Error(`Ninguna hoja del archivo tiene las columnas necesarias. Hojas revisadas: ${problems.join(', ')}. Se requiere al menos la columna de Tracking/Guía.`);
}

/**
 * Interpreta una celda de cobro (COD/FTC/ROD + monto) de forma robusta: acepta
 * número o texto, separadores de miles/decimales y elige el último monto.
 */
export function parsePaymentCell(raw: any): { amount: number; type: string | null } | null {
    if (raw === null || raw === undefined) return null;
    const s = String(raw).trim();
    if (!s) return null;

    const typeMatch = s.match(/\b(COD|FTC|ROD)\b/i);
    const type = typeMatch ? typeMatch[1].toUpperCase() : null;

    const amountMatches = s.match(/([0-9]+(?:[.,\s][0-9]{3})*(?:[.,][0-9]{1,2})?)/g);
    if (!amountMatches || amountMatches.length === 0) return null;

    let normalized = amountMatches[amountMatches.length - 1].trim();
    if (normalized.includes('.') && normalized.includes(',') && normalized.indexOf(',') > normalized.indexOf('.')) {
        normalized = normalized.replace(/\./g, '').replace(',', '.');           // 1.234,56 → 1234.56
    } else if (normalized.includes(',') && !normalized.includes('.')) {
        normalized = /,[0-9]{1,2}$/.test(normalized) ? normalized.replace(',', '.') : normalized.replace(/,/g, ''); // 1,50 → 1.50 / 1,234 → 1234
    } else {
        normalized = normalized.replace(/[\s,]/g, '');
    }

    const amount = parseFloat(normalized);
    if (isNaN(amount) || amount <= 0) return null;
    return { amount, type };
}

export function parseDynamicSheet(workbook: XLSX.WorkBook, options: ParseOptions): ParsedShipmentDto[] {
    const { fileName } = options;
    const is315 = fileName.toLowerCase().includes('31.5');
    
    const sheetNames = workbook.SheetNames;
    console.log(`📊 Archivo contiene ${sheetNames.length} hoja(s):`, sheetNames);

    // Buscar la primera hoja con headers válidos
    let targetSheet: XLSX.Sheet | null = null;
    let headerMap: Record<string, number> = {};
    let headerRowIndex = 0;

    const sheetProblems: string[] = [];
    for (const sheetName of sheetNames) {
        console.log(`🔍 Buscando headers en hoja: "${sheetName}"`);
        const sheet = workbook.Sheets[sheetName];

        try {
            const headerResult = getHeaderIndexMap(sheet);
            // EXIGIR la columna de Guía: una hoja con otros headers pero sin
            // trackingNumber NO es la de datos → se salta (no truena).
            if (headerResult.map.trackingNumber === undefined) {
                console.log(`⏭️ Hoja "${sheetName}" sin columna de Guía/Tracking - continuando...`);
                sheetProblems.push(`"${sheetName}" (sin columna de Guía/Tracking)`);
                continue;
            }
            targetSheet = sheet;
            headerMap = headerResult.map;
            headerRowIndex = headerResult.headerRowIndex;
            console.log(`✅ Headers válidos en hoja: "${sheetName}"`);
            break; // primera hoja con la columna de guía
        } catch (error) {
            console.log(`❌ No se encontraron headers en hoja "${sheetName}" - continuando...`);
            sheetProblems.push(`"${sheetName}" (sin encabezados reconocidos)`);
            continue;
        }
    }

    if (!targetSheet) {
        throw new Error(`Ninguna hoja del archivo tiene las columnas necesarias. Hojas revisadas: ${sheetProblems.join(', ')}. Se requiere al menos la columna de Tracking/Guía (revisa si los datos están en otra hoja o si el archivo es el correcto para este paso).`);
    }

    // Procesar solo la hoja que encontró headers
    const allRows: any[][] = XLSX.utils.sheet_to_json(targetSheet, {
        header: 1,
        range: 0,
        blankrows: false
    });
    
    console.log("🚀 ~ parseDynamicSheet ~ allRows encontrados:", allRows.length);

    const dataRows = allRows.slice(headerRowIndex + 1);

    return dataRows.map(row => {
        const rawDate = row[headerMap['commitDate']];
        const commitDate = formatExcelDateToMySQL(rawDate) ?? null;
        const recipientCity = row[headerMap['recipientCity']] ?? null;
        const payment = row[headerMap['cod']]

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
            consNumber: row[headerMap['consNumber']] ?? null,
            isPartOfCharge: is315,
        };
    }).filter(r => String(r.trackingNumber ?? '').trim() !== ''); // ignora filas sin guía (basura / 2ª hoja)
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
        const rawDate = row[headerMap['commitDate']];
        const commitDate = formatExcelDateToMySQL(rawDate) ?? null;


        return {
            trackingNumber: row[headerMap['trackingNumber']],
            recipientName: row[headerMap['recipientName']] ?? 'Sin Nombre',
            recipientAddress: row[headerMap['recipientAddress']] ?? 'Sin Dirección',
            recipientZip: row[headerMap['recipientZip']] ?? 'N/A',
            commitDate: commitDate, // ISO format string o null
            commitTime: formatExcelTimeToMySQL(row[headerMap['commitTime']]),
            recipientPhone: row[headerMap['recipientPhone']] ?? '',
            recipientCity: row[headerMap['recipientCity']] ?? ''
        };
    }).filter(r => String(r.trackingNumber ?? '').trim() !== ''); // ignora filas sin guía
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
            
            const typeMatch = includesCharge.match(/^(COD|FTC|ROD)/i);
            const paymentType = typeMatch ? (typeMatch[1].toUpperCase() as PaymentTypeEnum) : null;

            // Buscar todos los "tokens" numéricos (permite separadores de miles y decimales)
            const amountMatches = includesCharge.match(/([0-9]+(?:[.,\s][0-9]{3})*(?:\.[0-9]+)?)/g);

            console.log("🚀 ~ parseDynamicSheetCharge ~ amountMatches:", amountMatches)

            if (!amountMatches || amountMatches.length === 0) return null;

            // Elegir el último candidato (normalmente el monto está al final)
            const raw = amountMatches[amountMatches.length - 1];

            let normalized = raw.trim();

            if (normalized.includes('.') && normalized.includes(',') && normalized.indexOf(',') > normalized.indexOf('.')) {
                normalized = normalized.replace(/\./g, '').replace(',', '.');
            } else if (normalized.includes(',') && !normalized.includes('.')) {
                normalized = normalized.replace(',', '.');
            } else {
                normalized = normalized.replace(/[\s,]/g, '');
            }

            const paymentAmount = parseFloat(normalized);

            if (!isNaN(paymentAmount)) {
                newPayment.amount = paymentAmount;
                newPayment.type = paymentType;
                newPayment.status = PaymentStatus.PENDING;
            }

            shipmentsWithCharge.push({
                trackingNumber: row[headerMap['trackingNumber']],
                recipientAddress: row[headerMap['recipientAddress']],
                payment: newPayment,
            })                    
        }
    });

    console.log("🚀 ~ parseDynamicSheetCharge ~ shipmentsWithCharge:", shipmentsWithCharge)
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

export function parseDynamicSheetDHLResp2904(sheet: XLSX.Sheet) {
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

export function parseDynamicSheetDHL(sheet: XLSX.Sheet) {
    const allRows: any[][] = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        range: 0,
        blankrows: false,
        raw: false // raw: false para tratar fechas y teléfonos como strings
    });

    const { map: headerMap, headerRowIndex } = getHeaderIndexMap(sheet, 20, true);
    
    console.log("🚀 ~ parseDynamicSheetDHL ~ headerMap:", headerMap);

    const dataRows = allRows.slice(headerRowIndex + 1);

    return dataRows.map(row => {
        // Función segura para extraer datos: 
        // Primero busca la llave en inglés (que vemos en tu log), 
        // y si por alguna razón falla, busca la palabra en español como respaldo.
        const getValue = (enKey: string, esKey: string) => {
            let index = headerMap[enKey];
            if (index === undefined) index = headerMap[esKey];
            
            return index !== undefined ? row[index] : undefined;
        };


        return {
            // Mapeo ajustado a los encabezados del nuevo CSV exportado
            trackingNumber: getValue('trackingNumber', 'AWB Maestro'),
            
            // Mapeamos el identificador único (PID/JD) a la propiedad dhlUniqueId
            dhlUniqueId: getValue('dhlUniqueId', 'PID (Pieza)'), 
            
            recipientName: getValue('recipientName', 'Nombre'),
            
            // Aquí mapeamos la columna 'Dirección' que unimos en el export
            recipientAddress: getValue('recipientAddress', 'Dirección'),
            
            // Si el Excel tiene columnas separadas para ciudad, etc.
            recipientCity: getValue('recipientCity', 'Ciudad'),
            recipientZip: getValue('recipientZip', 'CP'),
            recipientPhone: getValue('recipientPhone', 'Teléfono'),
            
            // Mapeo de la columna que el usuario llenará manualmente
            commitDate: getValue('commitDate', 'Vencimiento (Commit Date)')
        };

        /*return {
            trackingNumber: getValue('trackingNumber', 'GUIA'),
            recipientName: getValue('recipientName', 'NOMBRE'),
            recipientAddress: getValue('recipientAddress', 'DIRECCION'),
            recipientAddress2: getValue('recipientAddress2', 'DIRECCION 2') || '',
            recipientZip: getValue('recipientZip', 'CP'),
            recipientPhone: getValue('recipientPhone', 'CEL'),
            commitDate: getValue('commitDate', 'VENCIMIENTO')
        };*/
    }).filter(dto => {
        // Evitamos que devuelva filas vacías si alguien coloreó celdas al final del Excel
        return dto.trackingNumber && String(dto.trackingNumber).trim() !== '';
    });
}


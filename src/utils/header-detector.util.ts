import * as XLSX from 'xlsx';

export function normalizeHeader(header: string): string {
    return headerAliases[header.trim().toLowerCase()] ?? header.trim().toLowerCase();
}

export interface HeaderDetectionResult {
    headerRowIndex: number;
    map: Record<string, number>;
}

export function getHeaderIndexMap(sheet: XLSX.Sheet, maxScanRows = 20, isForCharges: boolean = false): HeaderDetectionResult {
    const allRows = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        range: 0,
        blankrows: false,
    }) as any[][];

    for (let i = 0; i < Math.min(allRows.length, maxScanRows); i++) {
        const row = allRows[i];

        // Normaliza todos los valores de la fila
        const normalizedRow = row.map(cell => (typeof cell === 'string' ? normalizeHeader(cell) : ''));

        const hasKnownHeader = (isForCharges ? normalizedRow.some(h => Object.values(chargeHeaderAliases).includes(h)) : normalizedRow.some(h => Object.values(headerAliases).includes(h)));
    
        if (hasKnownHeader) {
            const headerMap: Record<string, number> = {};

            normalizedRow.forEach((header, index) => {
                if (header) {
                    headerMap[header] = index;
                }
            });

            return {
                headerRowIndex: i,
                map: headerMap,
            };
        }
    }

    throw new Error('No se pudieron detectar encabezados válidos en las primeras filas.');
}

export const headerAliases: Record<string, string> = {
    'tracking number': 'trackingNumber',
    'tracking no': 'trackingNumber',
    'hwb no': 'trackingNumber',
    'recip name': 'recipientName',
    'recipient name': 'recipientName',
    'recipient address': 'recipientAddress',
    'recip addr': 'recipientAddress',
    'rcvr addr 1': 'recipientAddress',
    'rcvr addr 2': 'recipientAddress2',
    'recipient city': 'recipientCity',
    'recip city': 'recipientCity',
    'recipient zip': 'recipientZip',
    'recip postal': 'recipientZip',
    'rcvr postcode': 'recipientZip',
    'commit date': 'commitDate',
    'edd': 'commitDate',
    'commit time': 'commitTime',
    'recip phone': 'recipientPhone',
    'phone': 'recipientPhone',
    'cod': 'payment',
    'last comm scan update': 'payment',
    'comm comment (comment contain) all': 'cod',
};

export const chargeHeaderAliases: Record<string, string> = {
    'tracking number': 'trackigNumber',
    'tracking no': 'trackingNumber',
    'recipient address': 'recipientAddress',
    'recip addr': 'recipientAddress',
    'comm comment (comment contain) all': 'cod',
    'cod': 'cod',
    'last comm scan update': 'cod',
}

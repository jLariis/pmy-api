import * as XLSX from 'xlsx';

function normalizeHeader(header: string): string {
    if (!header || typeof header !== 'string') return '';
    
    return header
        .trim()
        .toLowerCase()
        .replace(/[^\w\d\s]/g, ' ')  // Remover caracteres especiales
        .replace(/\s+/g, ' ')        // Multiples espacios a uno solo
        .trim()
        .replace(/\s/g, '');         // Eliminar TODOS los espacios
}

export interface HeaderDetectionResult {
    headerRowIndex: number;
    map: Record<string, number>;
}

export function getHeaderIndexMap(sheet: XLSX.Sheet, maxScanRows = 10, isForCharges: boolean = false): HeaderDetectionResult {
    const allRows = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        range: 0,
        defval: '',
        blankrows: true
    }) as any[][];

    console.log('=== DEBUG - PRIMERAS FILAS CRUDAS ===');
    for (let i = 0; i < Math.min(6, allRows.length); i++) {
        console.log(`Fila ${i}:`, allRows[i]);
    }

    for (let i = 0; i < Math.min(allRows.length, maxScanRows); i++) {
        const row = allRows[i];
        
        // DEBUG: Mostrar qué hay en esta fila específica
        console.log(`=== ANALIZANDO FILA ${i} ===`);
        console.log('Fila original:', row);
        
        // Normalizar SIN FILTRAR - mantener todas las celdas
        const normalizedRow = row.map(cell => {
            if (typeof cell === 'string') {
                const normalized = normalizeHeader(cell);
                console.log(`Celda "${cell}" → normalizada: "${normalized}"`);
                return normalized;
            }
            return '';
        });

        console.log('Fila completa normalizada:', normalizedRow);

        // Verificar si esta fila contiene headers conocidos
        const targetAliases = isForCharges ? chargeHeaderAliases : headerAliases;
        const allPossibleHeaders = Object.values(targetAliases).flat();
        
        console.log('Headers posibles:', allPossibleHeaders);
        
        // ✅ CAMBIO CLAVE: Buscar en las KEYS del headerAliases, no en los values
        const hasKnownHeader = normalizedRow.some(normalizedHeader => 
            normalizedHeader && Object.keys(headerAliases).includes(normalizedHeader)
        );

        console.log(`¿Fila ${i} tiene header conocido?`, hasKnownHeader);

        if (hasKnownHeader) {
            const headerMap: Record<string, number> = {};
            
            // Crear mapping con todas las celdas
            row.forEach((originalCell, index) => {
                if (typeof originalCell === 'string' && originalCell.trim() !== '') {
                    const normalized = normalizeHeader(originalCell);
                    if (normalized && headerAliases[normalized]) {
                        // Usar el nombre estandarizado del headerAliases
                        headerMap[headerAliases[normalized]] = index;
                    }
                }
            });

            console.log('Header map encontrado:', headerMap);
            
            return {
                headerRowIndex: i,
                map: headerMap,
            };
        }
    }

    throw new Error(`No se pudieron detectar encabezados válidos en las primeras ${maxScanRows} filas.`);
}


export const headerAliases: Record<string, string> = {
    // Tracking Number - SOLO versiones normalizadas en KEYS
    'trackingnumber': 'trackingNumber',
    'tracking': 'trackingNumber',
    'trackingno': 'trackingNumber',
    'numeroguia': 'trackingNumber',
    'hwbno': 'trackingNumber',
    'númerodeseguimiento': 'trackingNumber',
    'guia': 'trackingNumber',

    // Recipient Name
    'recipname': 'recipientName',
    'recipientname': 'recipientName',
    'nombredest': 'recipientName', // "nombre_dest" → "nombredest"
    'nombre': 'recipientName',
    'destinatario': 'recipientName',
    'receptor': 'recipientName',
    
    // Recipient Address
    'recipaddr': 'recipientAddress',
    'recipientaddress': 'recipientAddress',
    'rcvraddr1': 'recipientAddress', // "rcvr addr 1" → "rcvraddr1"
    'calledest': 'recipientAddress', // "calle_dest" → "calledest"
    'address': 'recipientAddress',
    'direccion': 'recipientAddress',
    'domicilio': 'recipientAddress',
    
    // Recipient Address 2
    'rcvraddr2': 'recipientAddress2', // "rcvr addr 2" → "rcvraddr2"
    'address2': 'recipientAddress2',
    'direccion2': 'recipientAddress2',
    
    // Recipient City
    'recipientcity': 'recipientCity',
    'recipcity': 'recipientCity', // "recip city" → "recipcity"
    'ciudad': 'recipientCity',
    'city': 'recipientCity',
    
    // Recipient Zip
    'recipientzip': 'recipientZip',
    'recipostal': 'recipientZip', // "recip postal" → "recipostal"
    'rcvrpostcode': 'recipientZip', // "rcvr postcode" → "rcvrpostcode"
    'codigopostaldest': 'recipientZip', // "codigo_postal_dest" → "codigopostaldest"
    'zip': 'recipientZip',
    'postal': 'recipientZip',
    'codigopostal': 'recipientZip',
    
    // Commit Date
    'commitdate': 'commitDate',
    'edd': 'commitDate',
    'date': 'commitDate',
    'fecha': 'commitDate',
    'fechacompromiso': 'commitDate',
    'fechaentrega': 'commitDate',
    
    // Commit Time
    'committime': 'commitTime',
    'time': 'commitTime',
    'hora': 'commitTime',
    'horacompromiso': 'commitTime',
    
    // Recipient Phone
    'recipphone': 'recipientPhone',
    'phone': 'recipientPhone',
    'telefono': 'recipientPhone',
    'celular': 'recipientPhone',
    'phonenumber': 'recipientPhone',
    
    // Payment/COD
    'cod': 'cod',
    'payment': 'cod',
    'cashondelivery': 'cod',
    'contraentrega': 'cod',
    'pagocontraentrega': 'cod',
    'pago': 'cod',
    
    // Additional fields - NORMALIZAR
    'lastcommscanupdate': 'cod', // "last comm scan update" → "lastcommscanupdate"
    'commcommentcommentcontainall': 'cod', // "comm comment (comment contain) all" → "commcommentcommentcontainall"
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

import * as XLSX from 'xlsx';

export type LayoutType = 'YAQUI_LOCAL' | 'BASIC' | 'LONG' | 'OPAR' | 'CABORCA' |  'YAQUI_2' | null;

export function detectLayoutType(sheet: XLSX.Sheet): LayoutType {
    const headers = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        range: 0,
        blankrows: false,
    })[0] as string[];

    console.log("🚀 ~ detectLayoutType ~ headers:", headers)

    const headersJoined = headers.join(' ').toLowerCase();
    
    console.log("🚀 ~ detectLayoutType ~ headersJoined:", headersJoined)
    
    /** Necesit más validación este Archivo: Carga YAQUI.xlsx */
    //if (headersJoined.includes('tracking no') && headersJoined.includes('recip name')) return 'YAQUI_2';
    if (headersJoined.includes('recip co.') && headersJoined.includes('cod')) return 'YAQUI_LOCAL';
    if (headersJoined.includes('recip name') && headersJoined.includes('commit time')) return 'BASIC';
    if (headersJoined.includes('shpr co') && headersJoined.includes('latest dept location')) return 'LONG';
    if (headersJoined.includes('cons number') && headersJoined.includes('tracking number')) return 'OPAR';
    if (headersJoined.includes('opar report')) return 'OPAR';
    if (headersJoined.includes('recip addr') && headersJoined.includes('last comm scan')) return 'CABORCA';
    if (headersJoined.includes('caborca-penasco-st ana-benjamin h.')) return 'CABORCA';
    if (headersJoined.includes('del yaqui')) return 'YAQUI_LOCAL'

    return null;
}

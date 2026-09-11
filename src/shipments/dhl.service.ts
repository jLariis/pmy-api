import { Injectable, Logger } from "@nestjs/common";
import axios from 'axios';
import pLimit from 'p-limit';
import { Shipment, ShipmentStatus } from "src/entities";
import { DhlShipmentDto } from "./dto/dhl/dhl-shipment.dto";
import { ShipmentType } from "src/common/enums/shipment-type.enum";
import { ShipmentStatusType } from "src/common/enums/shipment-status-type.enum";
import { Priority } from "src/common/enums/priority.enum";
import { mapDhlStatusTextToEnum } from "src/utils/dhl.utils";

/**
 * Resultado normalizado de la API oficial de DHL (Shipment Tracking - Unified)
 * por guía maestra (`trackingNumber` de 10 dígitos). Lo consume
 * `ShipmentsService.persistDhlNativeResults`.
 */
export interface DhlNativeResult {
    /** El número consultado (guía maestra de 10 dígitos). */
    queryTrackingNumber: string;
    /** ¿La API devolvió una guía? (404 → false, se omite). */
    found: boolean;
    /** Estatus de alto nivel: pre-transit | transit | delivered | failure | unknown. */
    statusCode?: string;
    /** Código DHL del último evento (OK/NH/BA/RD/CM/FD/PL/…). */
    eventCode?: string;
    /** Timestamp del último evento (ISO con offset). */
    timestamp?: string;
    /** Descripción legible del último evento/estatus. */
    description?: string;
    /** Localidad del último evento. */
    location?: string;
    /** JD de cada pieza de la guía (para persistir multi-pieza). */
    pieceIds: string[];
}

@Injectable()
export class DhlService {
    private readonly logger = new Logger(DhlService.name);

    /**
     * Límites REALES de la API oficial de DHL (Shipment Tracking - Unified), plan por defecto:
     *   • Spike arrest: 1 llamada cada 5 segundos.
     *   • Cuota diaria: 250 llamadas/día (ampliable por el portal). Al pasarla → 429 el resto del día.
     * Por eso: concurrencia 1 y cadencia `minIntervalMs` = 5s. La selección de guías se acota a
     * las que salieron a ruta (ver `ShipmentsService.getDhlToPollNative`) para no reventar la cuota.
     */
    private readonly concurrency = Number(process.env.DHL_TRACK_CONCURRENCY) || 1;
    /** Separación mínima entre INICIOS de request (spike arrest DHL = 1 cada 5s). */
    private readonly minIntervalMs = Number(process.env.DHL_TRACK_MIN_INTERVAL_MS) || 5000;
    /** Intentos por guía ante errores transitorios (5xx/red). El 429 se maneja aparte. */
    private readonly maxAttempts = Number(process.env.DHL_TRACK_MAX_ATTEMPTS) || 3;
    private readonly requestTimeoutMs = Number(process.env.DHL_TRACK_TIMEOUT_MS) || 20000;

    /** Instante (epoch ms) en que se puede lanzar el próximo request. Compartido entre guías. */
    private nextSlot = 0;

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * Puerta de cadencia: serializa el ARRANQUE de cada request para que estén separados al
     * menos `minIntervalMs`, aun con varias guías concurrentes. Reserva su turno de forma
     * atómica (avanza `nextSlot`) y espera hasta que llegue. Así respetamos el rate limit de DHL.
     */
    private async rateGate(): Promise<void> {
        if (this.minIntervalMs <= 0) return;
        const now = Date.now();
        const slot = Math.max(now, this.nextSlot);
        this.nextSlot = slot + this.minIntervalMs;
        const wait = slot - now;
        if (wait > 0) await this.sleep(wait);
    }

    /** Backoff exponencial con jitter (tope 8s). */
    private backoff(attempt: number): number {
        return Math.min(1000 * 2 ** (attempt - 1), 8000) + Math.floor(Math.random() * 400);
    }

    /**
     * Rastrea UNA guía maestra en la API oficial de DHL (Shipment Tracking - Unified):
     * `GET {DHL_API_URL}/track/shipments?trackingNumber={tn}&service=express`, header
     * `DHL-API-Key: DHL_CLIENT_KEY`. Sin token. Reintenta ante 429/5xx/red (backoff+jitter).
     * Un 404 = "sin datos" → `found:false` (NO es error). 401/403 = credencial inválida.
     */
    async trackByTrackingNumber(trackingNumber: string): Promise<DhlNativeResult> {
        const tn = `${trackingNumber}`.trim();
        const empty: DhlNativeResult = { queryTrackingNumber: tn, found: false, pieceIds: [] };
        if (!tn) return empty;

        const apiKey = process.env.DHL_CLIENT_KEY;
        const baseUrl = process.env.DHL_API_URL;
        if (!apiKey || !baseUrl) {
            throw new Error('❌ Faltan DHL_API_URL / DHL_CLIENT_KEY en el entorno.');
        }
        const url = `${baseUrl}/track/shipments`;

        let lastError: any;
        for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
            await this.rateGate(); // respeta la cadencia global antes de cada intento
            try {
                const response = await axios.get(url, {
                    params: { trackingNumber: tn, service: 'express' },
                    headers: { 'DHL-API-Key': apiKey },
                    timeout: this.requestTimeoutMs,
                });
                return this.normalizeNative(tn, response.data);
            } catch (error: any) {
                const status = error.response?.status;
                // 404: guía no encontrada aún en DHL → sin datos (no reintentar, no es error).
                if (status === 404) return empty;

                lastError = error;
                const isLast = attempt === this.maxAttempts;
                // 401/403: credencial inválida → no tiene sentido reintentar.
                if (status === 401 || status === 403) {
                    this.logger.error(`❌ DHL API-Key inválida/insuficiente (status ${status}) al consultar ${tn}.`);
                    throw error;
                }
                // 429: spike arrest (se recupera en ~5s) o CUOTA DIARIA agotada (no se recupera hoy,
                // sin Retry-After). Con la cadencia de 5s el spike no debería pasar; hacemos UN
                // reintento espaciado para descartarlo y, si persiste, marcamos cuota agotada para
                // que `trackBatch` ABORTE el ciclo (no tiene sentido intentar miles de guías más).
                if (status === 429) {
                    if (attempt < 2) {
                        const retryAfter = Number(error.response?.headers?.['retry-after']) || 0;
                        const wait = Math.max(retryAfter * 1000, this.minIntervalMs, 5000);
                        this.nextSlot = Math.max(this.nextSlot, Date.now() + wait);
                        await this.sleep(wait);
                        continue;
                    }
                    const quotaErr: any = new Error(`DHL 429: límite/cuota diaria excedido (${tn}).`);
                    quotaErr.dhlQuotaExhausted = true;
                    throw quotaErr;
                }
                // 5xx / red: transitorio → backoff exponencial y reintenta.
                if (!error.response || (status >= 500 && status <= 599)) {
                    if (!isLast) { await this.sleep(this.backoff(attempt)); continue; }
                }
                // 4xx no recuperable u otro → propaga.
                this.logger.error(`❌ Error API DHL [${tn}] (status ${status || error.code}): ${JSON.stringify(error.response?.data || error.message).slice(0, 200)}`);
                throw error;
            }
        }
        throw lastError;
    }

    /**
     * Rastrea muchas guías (cadencia 1 cada 5s, concurrencia 1). Las guías con 404 devuelven
     * `found:false` (se omiten al persistir). Si se detecta que la CUOTA DIARIA de DHL se agotó
     * (429 sostenido), se ABORTA el ciclo: las guías restantes se devuelven `found:false` sin
     * llamar a la API (se reintentarán en el próximo ciclo, ya con cuota). Así no generamos
     * miles de 429 inútiles.
     */
    async trackBatch(trackingNumbers: string[]): Promise<DhlNativeResult[]> {
        const numbers = Array.from(new Set((trackingNumbers || []).map((n) => `${n}`.trim()).filter(Boolean)));
        if (numbers.length === 0) return [];

        const limit = pLimit(this.concurrency);
        this.logger.log(`🚚 [DHL] Rastreando ${numbers.length} guías (1 cada ${this.minIntervalMs}ms)...`);

        let aborted = false;
        let skipped = 0;

        const results = await Promise.all(
            numbers.map((tn) =>
                limit(async () => {
                    const notFound = { queryTrackingNumber: tn, found: false, pieceIds: [] } as DhlNativeResult;
                    if (aborted) { skipped++; return notFound; }
                    try {
                        return await this.trackByTrackingNumber(tn);
                    } catch (e: any) {
                        if (e?.dhlQuotaExhausted) {
                            if (!aborted) {
                                this.logger.error(
                                    '⛔ [DHL] Cuota/límite diario alcanzado (429). Se ABORTA el ciclo; el resto se rastreará en el próximo. Considera subir la cuota en el portal DHL.',
                                );
                            }
                            aborted = true;
                            skipped++;
                            return notFound;
                        }
                        this.logger.warn(`[DHL] Falló ${tn} tras reintentos: ${e?.message}`);
                        return notFound;
                    }
                }),
            ),
        );

        const found = results.filter((r) => r.found).length;
        this.logger.log(
            `🏁 [DHL] Rastreo terminado: ${found}/${numbers.length} con datos` +
            (aborted ? ` · ABORTADO por cuota (${skipped} sin intentar)` : ''),
        );
        return results;
    }

    /** Normaliza la respuesta cruda de la API Unified a `DhlNativeResult`. */
    private normalizeNative(queryTrackingNumber: string, data: any): DhlNativeResult {
        const shipment = Array.isArray(data?.shipments) ? data.shipments[0] : undefined;
        if (!shipment) return { queryTrackingNumber, found: false, pieceIds: [] };

        const events = Array.isArray(shipment.events) ? shipment.events : [];
        // Evento más reciente (no asumimos orden del arreglo).
        const latest = events.length
            ? events.reduce((a: any, c: any) =>
                new Date(c?.timestamp || 0).getTime() > new Date(a?.timestamp || 0).getTime() ? c : a)
            : undefined;

        const pieceIds: string[] = Array.isArray(shipment?.details?.pieceIds)
            ? shipment.details.pieceIds.map((p: any) => `${p}`.trim()).filter(Boolean)
            : [];

        return {
            queryTrackingNumber,
            found: true,
            statusCode: shipment?.status?.statusCode ?? latest?.statusCode,
            eventCode: latest?.status ?? shipment?.status?.status,
            timestamp: latest?.timestamp ?? shipment?.status?.timestamp,
            description: latest?.description ?? shipment?.status?.description,
            location: latest?.location?.address?.addressLocality ?? shipment?.status?.location?.address?.addressLocality,
            pieceIds,
        };
    }


    public parseDhlTextResp2805(text: string): DhlShipmentDto[] {
    this.logOperationStart('parseDhlText');
    
    try {
        const shipments: DhlShipmentDto[] = [];
        const lines = text.split(/\r?\n/).map(l => l.trim());
        let currentShipment: DhlShipmentDto | null = null;
        let currentSection: 'awb' | 'header' | 'accounts' | 'receiver' | 'events' | null = null;

        for (const line of lines) {
            //console.log("🚀 ~ DHLService ~ parseDhlText ~ line:", line)
        
            // 1. Detectar AWB (nuevo envío)
            if (line.startsWith('AWB :')) {
                currentShipment = this.initializeDhlDto();
                currentShipment.awb = line.replace('AWB :', '').trim();
                currentSection = 'awb';
                continue;
            }

            // 2. Detectar sección de datos principales
            if (line.startsWith('Orig  Dest  Shipment Time') && currentShipment) {
                currentSection = 'header';
                continue;
            }

            // 3. Detectar sección de cuentas
            if (line.startsWith('Shpr Acct :') && currentShipment) {
                currentSection = 'accounts';
                const accountParts = line.split('Payer Acct :');
                currentShipment.shipperAccount = accountParts[0].replace('Shpr Acct :', '').trim();
                if (accountParts[1]) {
                    currentShipment.payerAccount = accountParts[1].trim();
                }
                continue;
            }

            // 4. Detectar sección de receiver
            if (line.includes('Shipper') && line.includes('Receiver') && currentShipment) {
                currentSection = 'receiver';
                continue;
            }

            // 5. Detectar sección de eventos
            if (line.includes('AWB/PID') && line.includes('Orig') && currentShipment) {
                currentSection = 'events';
                continue;
            }

            // Procesar contenido según la sección actual
            if (currentShipment) {
                switch (currentSection) {
                    case 'header':
                        if (/^[A-Z]{3}\s+[A-Z]{3}\s+\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(line)) {
                            const parts = line.split(/\s+/);
                            currentShipment.origin = parts[0];
                            currentShipment.destination = parts[1];
                            currentShipment.shipmentTime = `${parts[2]} ${parts[3]}`;
                            currentShipment.product = parts[4];
                            currentShipment.pieces = parseInt(parts[5]) || 0;
                            currentShipment.weight = parseFloat(parts[6]) || 0;
                            if (parts.length > 7) {
                                currentShipment.description = parts.slice(7).join(' ');
                            }
                        }
                        break;
                    
                    case 'receiver':
                        this.parseReceiverLine(line, currentShipment);
                        break;
                    
                    case 'events':
                        this.parseEventLine(line, currentShipment);
                        console.log("🚀 ~ DHLService ~ parseDhlText ~ currentShipment ~ events:", currentShipment)
                        break;
                }
            }
        }

        // Asegurar que el último envío se agregue
        if (currentShipment) {
            console.log("🚀 ~ DHLService ~ parseDhlText ~ currentShipment:", currentShipment)
            shipments.push(currentShipment);
        }

        this.logOperationSuccess('parseDhlText', { count: shipments.length });
        return shipments;
    } catch (error) {
        this.logOperationError('parseDhlText', error);
        throw new Error('Error parsing DHL text');
    }
    }

    public parseDhlTextResp2808(text: string): DhlShipmentDto[] {
        this.logOperationStart('parseDhlText');
        
        try {
            const shipments: DhlShipmentDto[] = [];
            const lines = text.split(/\r?\n/).map(l => l.trim());
            let currentShipment: DhlShipmentDto | null = null;
            let currentSection: 'awb' | 'header' | 'accounts' | 'receiver' | 'events' | null = null;

            for (const line of lines) {
                // 1. Detectar AWB (nuevo envío)
                if (line.startsWith('AWB :')) {
                    // Guardar el envío anterior si existe antes de procesar el nuevo
                    if (currentShipment) {
                        shipments.push(currentShipment);
                    }
                    
                    currentShipment = this.initializeDhlDto();
                    currentShipment.awb = line.replace('AWB :', '').trim();
                    currentShipment.remesas = []; // Inicializamos el arreglo de PIDs
                    currentSection = 'awb';
                    continue;
                }

                // 2. Detectar sección de datos principales
                if (line.startsWith('Orig  Dest  Shipment Time') && currentShipment) {
                    currentSection = 'header';
                    continue;
                }

                // 3. Detectar sección de cuentas
                if (line.startsWith('Shpr Acct :') && currentShipment) {
                    currentSection = 'accounts';
                    const accountParts = line.split('Payer Acct :');
                    currentShipment.shipperAccount = accountParts[0].replace('Shpr Acct :', '').trim();
                    if (accountParts[1]) {
                        currentShipment.payerAccount = accountParts[1].trim();
                    }
                    continue;
                }

                // 4. Detectar sección de receiver
                if (line.includes('Shipper') && line.includes('Receiver') && currentShipment) {
                    currentSection = 'receiver';
                    continue;
                }

                // 5. Detectar sección de eventos
                if (line.includes('AWB/PID') && line.includes('Orig') && currentShipment) {
                    currentSection = 'events';
                    continue;
                }

                // Procesar contenido según la sección actual
                if (currentShipment) {
                    switch (currentSection) {
                        case 'header':
                            if (/^[A-Z]{3}\s+[A-Z]{3}\s+\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(line)) {
                                const parts = line.split(/\s+/);
                                currentShipment.origin = parts[0];
                                currentShipment.destination = parts[1];
                                currentShipment.shipmentTime = `${parts[2]} ${parts[3]}`;
                                currentShipment.product = parts[4];
                                currentShipment.pieces = parseInt(parts[5]) || 0;
                                currentShipment.weight = parseFloat(parts[6]) || 0;
                                if (parts.length > 7) {
                                    currentShipment.description = parts.slice(7).join(' ');
                                }
                            }
                            break;
                        
                        case 'receiver':
                            this.parseReceiverLine(line, currentShipment);
                            break;
                        
                        case 'events':
                            // Omitir encabezados o líneas separadoras
                            if (line && !line.startsWith('-') && !line.includes('AWB/PID')) {
                                const firstToken = line.split(/\s+/)[0];
                                
                                // Si el token existe, es largo (para evitar falsos positivos) y es distinto al AWB maestro, es un PID
                                if (firstToken && firstToken.length > 8 && firstToken !== currentShipment.awb) {
                                    if (!currentShipment.remesas) {
                                        currentShipment.remesas = [];
                                    }
                                    // Evitar duplicados
                                    if (!currentShipment.remesas.includes(firstToken)) {
                                        currentShipment.remesas.push(firstToken);
                                    }
                                }
                            }

                            this.parseEventLine(line, currentShipment);
                            break;
                    }
                }
            }

            // Asegurar que el último envío del texto se agregue al arreglo
            if (currentShipment) {
                shipments.push(currentShipment);
            }

            this.logOperationSuccess('parseDhlText', { count: shipments.length });
            return shipments;
        } catch (error) {
            this.logOperationError('parseDhlText', error);
            throw new Error('Error parsing DHL text');
        }
    }

    public parseDhlText(text: string): DhlShipmentDto[] {
        this.logOperationStart('parseDhlText');
        
        try {
            const shipments: DhlShipmentDto[] = [];
            const lines = text.split(/\r?\n/).map(l => l.trim());
            let currentShipment: DhlShipmentDto | null = null;
            let currentSection: 'awb' | 'header' | 'accounts' | 'receiver' | 'events' | null = null;

            // Función auxiliar interna ajustada con Loggers
            const processAndAddShipment = (shipment: DhlShipmentDto) => {
                if (shipment.remesas && shipment.remesas.length > 0) {
                    if (shipment.pieces > 1) {
                        this.logger.debug(`[Multi-pieza] AWB ${shipment.awb} | piezas ${shipment.pieces} | PIDs ${shipment.remesas.length}`);

                        // Multi-pieza: Creamos un registro independiente por cada PID (JD/JJD)
                        shipment.remesas.forEach((pid) => {
                            const childShipment = JSON.parse(JSON.stringify(shipment));
                            childShipment.pid = pid;
                            childShipment.remesas = []; // Limpiamos para evitar redundancia
                            shipments.push(childShipment);
                        });
                    } else {
                        // 1 sola pieza: Asignamos su único JD a la propiedad pid
                        shipment.pid = shipment.remesas[0];
                        shipment.remesas = [];
                        shipments.push(shipment);
                    }
                } else {
                    this.logger.debug(`[Sin PIDs] AWB ${shipment.awb} se procesará sin PID.`);
                    // Fallback sin PIDs detectados
                    shipments.push(shipment);
                }
            };

            // Deduplicación por AWB: DHL marca "Duplicate AWB!" cuando la misma guía
            // aparece 2 veces (normalmente el 2º bloque viene vacío). En vez de crear
            // 2 filas, fusionamos en una sola conservando los datos reales.
            const byAwb = new Map<string, DhlShipmentDto>();
            const mergeDhl = (base: any, inc: any) => {
                for (const f of ['origin', 'destination', 'shipmentTime', 'product', 'description', 'shipperAccount', 'payerAccount']) {
                    if (!base[f] && inc[f]) base[f] = inc[f];
                }
                base.pieces = Math.max(base.pieces || 0, inc.pieces || 0);
                base.weight = base.weight || inc.weight || 0;
                if (!base.receiver?.name && inc.receiver?.name) base.receiver = inc.receiver;
                base.remesas = Array.from(new Set([...(base.remesas || []), ...(inc.remesas || [])]));
                base.events = [...(base.events || []), ...(inc.events || [])];
            };
            const commit = (sh: DhlShipmentDto | null) => {
                if (!sh || !sh.awb) return;
                const existing = byAwb.get(sh.awb);
                if (!existing) byAwb.set(sh.awb, sh);
                else mergeDhl(existing, sh);
            };

            for (const line of lines) {
                // 1. Detectar AWB (nuevo envío)
                if (line.startsWith('AWB :')) {
                    if (currentShipment) {
                        commit(currentShipment);
                    }

                    currentShipment = this.initializeDhlDto();
                    // El AWB es el primer token. DHL a veces anexa "Duplicate AWB!"
                    // (mismo AWB repetido en el archivo) → nos quedamos solo con el número.
                    currentShipment.awb = line.replace('AWB :', '').trim().split(/\s+/)[0] || '';
                    currentShipment.remesas = [];
                    currentSection = 'awb';
                    continue;
                }

                // ... Resto del código intacto ...
                // 2. Detectar sección de datos principales
                if (line.startsWith('Orig  Dest  Shipment Time') && currentShipment) {
                    currentSection = 'header';
                    continue;
                }

                // 3. Detectar sección de cuentas
                if (line.startsWith('Shpr Acct :') && currentShipment) {
                    currentSection = 'accounts';
                    const accountParts = line.split('Payer Acct :');
                    currentShipment.shipperAccount = accountParts[0].replace('Shpr Acct :', '').trim();
                    if (accountParts[1]) {
                        currentShipment.payerAccount = accountParts[1].trim();
                    }
                    continue;
                }

                // 4. Detectar sección de receiver
                if (line.includes('Shipper') && line.includes('Receiver') && currentShipment) {
                    currentSection = 'receiver';
                    continue;
                }

                // 5. Detectar sección de eventos
                if (line.includes('AWB/PID') && line.includes('Orig') && currentShipment) {
                    currentSection = 'events';
                    continue;
                }

                // Procesar contenido según la sección actual
                if (currentShipment) {
                    switch (currentSection) {
                        case 'header':
                            if (/^[A-Z]{3}\s+[A-Z]{3}\s+\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(line)) {
                                const parts = line.split(/\s+/);
                                currentShipment.origin = parts[0];
                                currentShipment.destination = parts[1];
                                currentShipment.shipmentTime = `${parts[2]} ${parts[3]}`;
                                currentShipment.product = parts[4];
                                currentShipment.pieces = parseInt(parts[5]) || 0;
                                currentShipment.weight = parseFloat(parts[6]) || 0;
                                if (parts.length > 7) {
                                    currentShipment.description = parts.slice(7).join(' ');
                                }
                            }
                            break;
                        
                        case 'receiver':
                            this.parseReceiverLine(line, currentShipment);
                            break;
                        
                        case 'events':
                            // Omitir encabezados o líneas separadoras
                            if (line && !line.startsWith('-') && !line.includes('AWB/PID')) {
                                const firstToken = line.split(/\s+/)[0];
                                
                                // Si el token existe, es largo y es distinto al AWB maestro, es un PID (JD/JJD)
                                if (firstToken && firstToken.length > 8 && firstToken !== currentShipment.awb) {
                                    if (!currentShipment.remesas) {
                                        currentShipment.remesas = [];
                                    }
                                    if (!currentShipment.remesas.includes(firstToken)) {
                                        currentShipment.remesas.push(firstToken);
                                    }
                                }
                            }

                            this.parseEventLine(line, currentShipment);
                            break;
                    }
                }
            }

            // Cerrar el último bloque y luego procesar (expandir a PIDs) los AWB ya deduplicados.
            commit(currentShipment);
            for (const sh of byAwb.values()) {
                processAndAddShipment(sh);
            }

            this.logOperationSuccess('parseDhlText', { count: shipments.length });
            return shipments;
        } catch (error) {
            this.logOperationError('parseDhlText', error);
            throw new Error('Error parsing DHL text');
        }
    }

    private initializeDhlDto(): DhlShipmentDto {
        return {
            awb: '', // No aparece en el ejemplo
            origin: '',
            destination: '',
            shipmentTime: '',
            product: '',
            pieces: 0,
            weight: 0,
            description: '',
            shipperAccount: '',
            payerAccount: '',
            receiver: {
            name: '',
            contactName: '',
            address1: '',
            address2: '',
            city: '',
            state: '',
            country: '',
            zip: '',
            phone: ''
            },
            events: []
        };
    }

    private parseReceiverLine(line: string, dto: DhlShipmentDto): void {
        // Busca todos los pares key: value en la línea
        const keyValuePairs = [...line.matchAll(/([^:]+):\s*([^:]+?)(?=\s{2,}|$)/g)];

        // Si hay menos de dos pares, no hacemos nada
        if (keyValuePairs.length < 2) return;

        // Tomamos el segundo par (que es el del receiver)
        const [, rawKey, rawValue] = keyValuePairs[1];
        const key = rawKey.trim();
        const value = rawValue.trim();

        switch (key) {
            case 'Name': dto.receiver.name = value; break;
            case 'Ctc Nm': dto.receiver.contactName = value; break;
            case 'Addr 1': dto.receiver.address1 = value; break;
            case 'Addr 2': dto.receiver.address2 = value; break;
            case 'City': dto.receiver.city = value; break;
            case 'State': dto.receiver.state = value; break;
            case 'Ctry': dto.receiver.country = value; break;
            case 'Zip': dto.receiver.zip = value; break;
            case 'Phone': dto.receiver.phone = value; break;
        }
    }

    private parseEventLine(line: string, dto: DhlShipmentDto): void {
        if (!line.trim() || line.includes('-----')) return;

        // Expresión regular: captura entre espacios múltiples (>=2) o delimitadores consistentes
        const parts = line.trim().split(/\s{2,}/);

        // Si hay menos de 7 partes, la línea está mal formada
        if (parts.length < 7) return;

        // Manejo de AWB/PID que puede estar vacío en algunas líneas
        let awbPid = parts[0].length >= 10 ? parts[0].trim() : '';
        if (!awbPid) {
            awbPid = dto.awb;
        }

        const event = {
            awbPid,
            origin: parts[1] || '',
            destination: parts[2] || '',
            facilityId: parts[3] || '',
            route: parts[4] || '',
            code: parts[5] || '',
            eventDateTime: parts[6] || '',
            dataAvailable: parts[7] || '',
            remark: parts.slice(8).join(' ') || ''
        };

        
        //console.log("🚀 ~ DHLService ~ parseEventLine ~ event:", event)

        // Solo agregar si el código existe y el awbPid corresponde
        if (event.code && (event.awbPid === dto.awb)) {
            dto.events.push(event);
        }
        console.log("🚀 ~ DHLService ~ parseEventLine ~ dto.events:", dto.events)
    }

    public populateShipmentFromDhlDto(shipment: Shipment, dto: DhlShipmentDto): void {
        shipment.trackingNumber = dto.awb;
        shipment.shipmentType = ShipmentType.DHL;
        shipment.recipientName = dto.receiver.contactName || dto.receiver.name;
        shipment.recipientAddress = `${dto.receiver.address1} ${dto.receiver.address2}`.trim();
        shipment.recipientCity = dto.receiver.city;
        shipment.recipientZip = dto.receiver.zip;
        shipment.recipientPhone = dto.receiver.phone;
        shipment.status = ShipmentStatusType.PENDIENTE;
        shipment.priority = Priority.BAJA;

        if (dto.shipmentTime) {
            const commitDateTime = new Date(dto.shipmentTime);
            shipment.commitDateTime = commitDateTime;
            //shipment.commitDate = commitDateTime.toISOString().split('T')[0];
            //shipment.commitTime = commitDateTime.toTimeString().split(' ')[0];
        }
    }

    public createStatusHistoryFromDhlEvents(events: DhlShipmentDto['events']): ShipmentStatus[] {
        return events.map(event => {
            const status = new ShipmentStatus();
            status.status = mapDhlStatusTextToEnum(event.code) || ShipmentStatusType.PENDIENTE;
            status.timestamp = new Date(event.eventDateTime);
            status.notes = `${event.remark || ''} ${event.facilityId ? `(${event.facilityId})` : ''}`.trim();
            return status;
        });
    }   

    logOperationStart(operation: string) {
        this.logger.log(`🚀 Starting operation: ${operation}`);
    }

    logOperationSuccess(operation: string, data?: any) {
        this.logger.log(`✅ Successfully completed: ${operation}`, data ? JSON.stringify(data) : '');
    }

    logOperationError(operation: string, error: Error) {
        this.logger.error(`❌ Failed operation: ${operation}`, error.stack);
    }
}
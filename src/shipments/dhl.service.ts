import { Injectable, Logger } from "@nestjs/common";
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { Shipment, ShipmentStatus } from "src/entities";
import { DhlShipmentDto } from "./dto/dhl/dhl-shipment.dto";
import { ShipmentType } from "src/common/enums/shipment-type.enum";
import { ShipmentStatusType } from "src/common/enums/shipment-status-type.enum";
import { Priority } from "src/common/enums/priority.enum";
import { mapDhlStatusTextToEnum } from "src/utils/dhl.utils";

@Injectable()
export class DhlService {
    private readonly logger = new Logger(DhlService.name);
    private currentAWB: string | null = null;

    // Ruta del archivo en la raíz del proyecto para guardar el token de BlueDart/DHL
    private readonly tokenPath = path.join(process.cwd(), 'dhl-token.json');

    /**
     * Obtiene el JWT Token (Basado en la API de Blue Dart / DHL)
     */
    public async getSmartToken(): Promise<string> {
        const now = Date.now();
        let cachedData = this.readTokenFromFile();

        // Validamos si el token existe y si aún es válido
        if (cachedData && cachedData.token && now < (cachedData.expiresAt - 300000)) {
            return cachedData.token;
        }

        const clientID = process.env.DHL_CLIENT_ID;
        const clientSecret = process.env.DHL_CLIENT_SECRET;
       
        if (!clientID || !clientSecret) {
            throw new Error('❌ Las variables de entorno de DHL (ClientID / clientSecret) no están definidas.');
        }

        try {
            this.logger.log('🔑 Solicitando nuevo token a DHL/Blue Dart...');
            
            // La documentación indica que es un método GET pasando las credenciales en los headers
            const response = await axios.get(`${process.env.DHL_API_AUTH}`, {
                headers: {
                    'ClientID': clientID,
                    'clientSecret': clientSecret
                }
            });

            // La respuesta entrega la propiedad JWTToken
            const token = response.data.JWTToken;
            
            // Asumimos una expiración estándar (ej. 1 hora) ya que la doc no especifica el tiempo de vida
            const expiresAt = Date.now() + (3600 * 1000);

            // Guardamos el token en nuestro archivo local
            this.saveTokenToFile(token, expiresAt);

            return token;
        } catch (error) {
            this.logger.error('❌ Error al obtener token de DHL', error.response?.data || error.message);
            throw error;
        }
    }

    private saveTokenToFile(token: string, expiresAt: number) {
        try {
            const data = JSON.stringify({ token, expiresAt }, null, 2);
            fs.writeFileSync(this.tokenPath, data, 'utf8');
            this.logger.log('💾 Token persistido en dhl-token.json');
        } catch (error) {
            this.logger.error('❌ No se pudo escribir el archivo de token', error);
        }
    }

    private readTokenFromFile(): { token: string; expiresAt: number } | null {
        try {
            if (!fs.existsSync(this.tokenPath)) {
                this.logger.warn('📄 Archivo de token no encontrado. Se creará uno nuevo al solicitarlo.');
                return null;
            }
            const data = fs.readFileSync(this.tokenPath, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            this.logger.error('❌ Error al leer o parsear el archivo de token', error);
            return null;
        }
    }

    private deleteTokenFile() {
        if (fs.existsSync(this.tokenPath)) {
            fs.unlinkSync(this.tokenPath);
            this.logger.warn('🗑️ Token local eliminado por invalidez.');
        }
    }
    
    /**
     * Rastrea el paquete usando la API principal de DHL Track.
     * Nota: Este endpoint en particular usa un API Key directamente.
     */
    async trackPackage(trackingNumber: string): Promise<any> {
        this.logger.log(`Rastreando guía DHL: ${trackingNumber}`);
        
        //const token = await this.getSmartToken();
        //console.log("🚀 ~ DhlService ~ trackPackage ~ token:", token)

        // Endpoint principal de rastreo de DHL
        const trackingUrl = `${process.env.DHL_API_URL}/track/shipments?trackingNumber=${trackingNumber}`;
        
        try {
            // La documentación indica que se usa un método GET con el DHL-API-Key en el header
            //'Authorization': `Bearer ${token}`

            const response = await axios.get(trackingUrl, {
                headers: {
                    'DHL-API-Key': `${process.env.DHL_CLIENT_ID}`
                },
                timeout: 10000, 
            });
        
            // Opcional: Aquí puedes mapear la respuesta con plainToInstance si tienes un DTO definido
            // const trackData = plainToInstance(DhlTrackingResponseDto, response.data);
            
            return response.data;
        
        } catch (error) {
            if (error.response?.status === 401) {
                this.logger.warn(`API Key inválida o expirada al consultar [${trackingNumber}].`);
            }
            
            const errorData = error.response?.data || error.message;
            this.logger.error(`❌ Error API DHL [${trackingNumber}]:`, JSON.stringify(errorData));
            
            throw error; 
        }
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
import { Injectable, Logger } from '@nestjs/common';
import { DhlShipmentDto } from './dto/dhl/dhl-shipment.dto';
import { Shipment, ShipmentStatus } from '../entities';
import { Priority } from '../common/enums/priority.enum';
import { ShipmentStatusType } from '../common/enums/shipment-status-type.enum';
import { ShipmentType } from '../common/enums/shipment-type.enum';
import { mapDhlStatusTextToEnum } from 'src/utils/dhl.utils';

@Injectable()
export class DHLService {
  private readonly logger = new Logger(DHLService.name);
  private currentAWB: string | null = null;

  public parseDhlText(text: string): DhlShipmentDto[] {
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
      shipment.commitDate = commitDateTime.toISOString().split('T')[0];
      shipment.commitTime = commitDateTime.toTimeString().split(' ')[0];
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
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CreateInventoryDto } from './dto/create-inventory.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Inventory } from 'src/entities/inventory.entity';
import { In, Not, Repository } from 'typeorm';
import { ChargeShipment, Consolidated, Shipment, Subsidiary } from 'src/entities';
import { ValidatedPackageDispatchDto } from 'src/package-dispatch/dto/validated-package-dispatch.dto';
import { MailService } from 'src/mail/mail.service';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import * as ExcelJS from 'exceljs';

export interface ShipmentWithout67 {
  trackingNumber: string;
  currentStatus: string;
  statusHistoryCount: number;
  exceptionCodes: string[];
  firstStatusDate: Date | null;
  lastStatusDate: Date | null;
  daysInSystem: number | null;
  comment: string;
}

export interface Inventory67Response {
  summary: {
    totalShipments: number;
    withoutCode67: number;
    withCode67: number;
    inventoryDate?: Date;
    percentageWithout67: number;
    inventoryId?: string;
  };
  details: ShipmentWithout67[];
}

@Injectable()
export class InventoriesService {
  private readonly logger = new Logger(InventoriesService.name);

  constructor(
    @InjectRepository(Inventory)
    private readonly inventoryRepository: Repository<Inventory>,
    @InjectRepository(Shipment)
    private readonly shipmentRepository: Repository<Shipment>,
    @InjectRepository(ChargeShipment)
    private readonly chargeShipmentRepository: Repository<ChargeShipment>,
    @InjectRepository(Consolidated)
    private readonly consolidatedRepository: Repository<Consolidated>,
    @InjectRepository(Subsidiary)
    private readonly subsidiaryRepository: Repository<Subsidiary>,
    private readonly mailService: MailService
  ){}

  async create(createInventoryDto: CreateInventoryDto) {
    const { inventoryDate, shipments, chargeShipments, subsidiary } = createInventoryDto;

    // Buscar entidades .findBy({ id: In([1, 2, 3]) })
    const shipmentsToSave = await this.shipmentRepository.findBy({id: In(shipments)});
    const chargeShipmentsToSave = await this.chargeShipmentRepository.findBy({id: In(chargeShipments)});
    const subsidiaryObj = await this.subsidiaryRepository.findOneBy({ id: subsidiary.id });

    const newInventory = this.inventoryRepository.create({
      inventoryDate,
      shipments: shipmentsToSave,
      chargeShipments: chargeShipmentsToSave,
      subsidiary: subsidiaryObj,
    });

    return await this.inventoryRepository.save(newInventory);
  }

  async validatePackage(
      packageToValidate: ValidatedPackageDispatchDto,
      subsidiaryId: string
    ): Promise<ValidatedPackageDispatchDto> {
      let isValid = true;
      let reason = '';
  
      /*const existePackageOnPackageDispatch = await this.inventoryRepository
      .createQueryBuilder('package')
      .leftJoinAndSelect('shipment', 'shipment', 'shipment.routeId = package.id')
      .select([
        'package.id AS package_id',
        'shipment.trackingNumber AS shipment_trackingNumber', // Fix: Use shipment.trackingNumber
        'package.status AS package_status',
        'package.startTime AS package_startTime',
        'package.estimatedArrival AS package_estimatedArrival',
        'package.createdAt AS package_createdAt',
        'package.updatedAt AS package_updatedAt',
        'package.vehicleId AS package_vehicleId',
        'package.subsidiaryId AS package_subsidiaryId',
      ])
      .where('shipment.trackingNumber = :trackingNumber', { trackingNumber: packageToValidate.trackingNumber })
      .getRawOne();*/
  
      /*const existPackageOnReturn = await this.devolutionRepository.findOne({
        where: { trackingNumber: packageToValidate.trackingNumber },
      })*/
  
      /*if (existePackageOnPackageDispatch) {
        isValid = false;
        reason = 'El paquete ya existe en otra salida a ruta';
      }
  
      if(existPackageOnReturn) {
        isValid = false;
        reason = 'El paquete existe en una devolución';
      }*/
  
      if (packageToValidate.subsidiary.id !== subsidiaryId) {
        isValid = false;
        reason = 'El paquete no pertenece a la sucursal actual';
      }
  
      // Permitir por ahora...
      /*if (packageToValidate.status === ShipmentStatusType.ENTREGADO) {
        isValid = false;
        reason = 'El paquete ya ha sido entregado';
      }*/
  
      return {
        ...packageToValidate,
        isValid,
        reason
      };
  }

  async validateTrackingNumber(
    trackingNumber: string,
    subsidiaryId?: string
  ): Promise<ValidatedPackageDispatchDto & { isCharge?: boolean; consolidated?: Consolidated }> {
    const shipment = await this.shipmentRepository.findOne({
      where: { 
        trackingNumber,
        status: Not(ShipmentStatusType.DEVUELTO_A_FEDEX) 
      },
      relations: ['subsidiary', 'statusHistory', 'payment'],
      order: { createdAt: 'DESC' }
    });


    if (!shipment) {
      const chargeShipment = await this.chargeShipmentRepository.findOne({
        where: { 
          trackingNumber,
          status: Not(ShipmentStatusType.DEVUELTO_A_FEDEX) 
        },
        relations: ['subsidiary', 'charge', 'payment'],
        order: { createdAt: 'DESC' }
      });

      if (!chargeShipment) {
      // Retornar DTO mínimo con un mensaje indicando el motivo
      return {
        trackingNumber,
        isValid: false,
        reason: 'No se encontraron datos para el tracking number en la base de datos',
        subsidiary: null,
        status: null,
      };
    }

      const validatedCharge = await this.validatePackage(
        {
          ...chargeShipment,
          isValid: false,
        },
        subsidiaryId
      );

      return {
        ...validatedCharge,
        isCharge: true,
      };
    }

    const consolidated = await this.consolidatedRepository.findOne({
      where: { id: shipment.consolidatedId },
    });

    const validatedShipment = await this.validatePackage(
      {
        ...shipment,
        isValid: false,
        isCharge: false,
      },
      subsidiaryId
    );

    return {
      ...validatedShipment,
      consolidated,
    };
  }

  async validateTrackingNumbers(
      trackingNumbers: string[],
      subsidiaryId?: string
    ): Promise<{
      validatedShipments: (ValidatedPackageDispatchDto & { isCharge?: boolean })[];
    }> {
      // 1️⃣ Traer shipments y chargeShipments en batch
      const shipments = await this.shipmentRepository.find({
        where: { trackingNumber: In(trackingNumbers),  status: Not(ShipmentStatusType.DEVUELTO_A_FEDEX) },
        relations: ['subsidiary', 'statusHistory', 'payment', 'packageDispatch'],
        order: { createdAt: 'DESC' },
      });
  
      const chargeShipments = await this.chargeShipmentRepository.find({
        where: { trackingNumber: In(trackingNumbers),  status: Not(ShipmentStatusType.DEVUELTO_A_FEDEX) },
        relations: ['subsidiary', 'charge', 'packageDispatch', 'payment'],
      });
  
      // Mapas para acceso rápido por trackingNumber
      const shipmentsMap = new Map(shipments.map(s => [s.trackingNumber, s]));
      const chargeMap = new Map(chargeShipments.map(c => [c.trackingNumber, c]));
  
      const validatedShipments: (ValidatedPackageDispatchDto & { isCharge?: boolean })[] = [];
  
      // 2️⃣ Validar todos los trackingNumbers recibidos
      for (const tn of trackingNumbers) {
        const shipment = shipmentsMap.get(tn);
        if (shipment) {
          const validated = await this.validatePackage({ ...shipment, isValid: false }, subsidiaryId);
          validatedShipments.push({...validated, isCharge: false});
          continue;
        }
  
        const chargeShipment = chargeMap.get(tn);
        if (chargeShipment) {
          const validatedCharge = await this.validatePackage({ ...chargeShipment, isValid: false }, subsidiaryId);
          validatedShipments.push({ ...validatedCharge, isCharge: true });
          continue;
        }
  
        validatedShipments.push({
          trackingNumber: tn,
          isValid: false,
          reason: 'No se encontraron datos para el tracking number en la base de datos',
          subsidiary: null,
          status: null,
        });
      }
  
      return { validatedShipments };
    }

  async findAll(subsidiaryId: string) {
    return await this.inventoryRepository.find({
      where: {
        subsidiary: {
          id: subsidiaryId
        }
      },
      order: {
        inventoryDate: 'DESC'
      },
      relations: ['subsidiary', 'shipments', 'chargeShipments']
    });
  }

  async findOne(id: string) {
    return await this.inventoryRepository.findOneBy({id});
  }

  async getPriorityPackages(inventory: Inventory) {
      const timeZone = "America/Hermosillo";

      const todayUTC = new Date();
      todayUTC.setUTCHours(0, 0, 0, 0);
  
      const tomorrowUTC = new Date(todayUTC);
      tomorrowUTC.setUTCDate(tomorrowUTC.getUTCDate() + 1);
  
      if (!inventory) return null;
  
      const shipments = (inventory.shipments || []).filter(
        s => 
          s.commitDateTime >= todayUTC && 
          s.commitDateTime < tomorrowUTC &&
          s.status === ShipmentStatusType.EN_RUTA
      );
  
      const chargeShipments = (inventory.chargeShipments || []).filter(
        cs => 
          cs.commitDateTime >= todayUTC && 
          cs.commitDateTime < tomorrowUTC &&
          cs.status === ShipmentStatusType.EN_RUTA
      );
  
      const htmlRows = [...shipments, ...chargeShipments]
        .map(
          (s) => `
            <tr style="border-bottom: 1px solid #ddd;">
              <td style="padding: 8px; text-align: center;">${s.trackingNumber ?? "N/A"}</td>
              <td style="padding: 8px;">${s.subsidiary?.name ?? "N/A"}</td>
              <td style="padding: 8px; text-align: center;">
                ${
                  s.commitDateTime
                    ? new Date(s.commitDateTime).toLocaleDateString("es-MX", {
                        timeZone: "America/Hermosillo",
                      })
                    : "Sin fecha"
                }
              </td>
              <td style="padding: 8px; text-align: center;">
                ${s.payment ? `${s.payment.type} $ ${s.payment.amount}` : ""}
              </td>
              <td style="padding: 8px; text-align: center;">${s.status ?? "N/A"}</td>
            </tr>
          `
        )
        .join("");
  
      const htmlContent = `
        <div style="font-family: Arial, sans-serif; color: #2c3e50; max-width: 800px; margin: auto;">
          <h2 style="border-bottom: 3px solid #e74c3c; padding-bottom: 8px;">
            Reporte de Inventario con Paquetes Críticos
          </h2>
  
          <p>
            Dentro del Inventario <strong>${inventory.trackingNumber ?? "N/A"}</strong>
            se han detectado paquetes con fecha de vencimiento el día de hoy 
            (<strong>${new Date(inventory.inventoryDate).toLocaleDateString('es-MX', { timeZone: 'America/Hermosillo' })}</strong>).
          </p>
  
          <p style="color:#c0392b; font-weight:bold;">
            Estos envíos deben ser considerados para <u>entrega inmediata</u>.
          </p>
  
          <table 
            border="0" 
            cellpadding="0" 
            cellspacing="0" 
            style="border-collapse: collapse; width: 100%; box-shadow: 0 0 10px rgba(0,0,0,0.05); margin-top: 15px;"
          >
            <thead style="background-color: #f7f7f7; text-align: center;">
              <tr>
                <th style="padding: 10px;">Tracking Number</th>
                <th style="padding: 10px;">Destino</th>
                <th style="padding: 10px;">Fecha de Vencimiento</th>
                <th style="padding: 10px;">Cobro</th>
                <th style="padding: 10px;">Estatus</th>
              </tr>
            </thead>
            <tbody>
              ${
                htmlRows ||
                `<tr>
                  <td colspan="5" style="text-align: center; padding: 15px; color: #7f8c8d;">
                    No se encontraron paquetes vencidos en el día.
                  </td>
                </tr>`
              }
            </tbody>
          </table>
  
          <p style="margin-top: 20px; font-weight: bold; color: #c0392b;">
            Este correo se genera automáticamente debido a la criticidad de la descarga.
          </p>
  
          <p style="margin-top: 20px;">
            Para un monitoreo detallado de los envíos, por favor visite: 
            <a href="https://app-pmy.vercel.app/" target="_blank" style="color: #2980b9; text-decoration: none;">
              https://app-pmy.vercel.app/
            </a>
          </p>
  
          <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;" />
  
          <p style="font-size: 0.9em; color: #7f8c8d;">
            Este correo fue enviado automáticamente por el sistema.<br />
            Por favor, no responda a este mensaje.
          </p>
        </div>
      `;
  
      const result = await this.mailService.sendHighPriorityPackagesOnInvetory({
        to: inventory.subsidiary.officeEmail,
        cc: `${inventory.subsidiary.officeEmailToCopy}, sistemas@paqueteriaymensajeriadelyaqui.com`,
        //cc: 'javier.rappaz@gmail.com'
        htmlContent
      });
  
      this.logger.debug('Correo enviado correctamente:', result);
  
      return { ...inventory, shipments, chargeShipments };
  }

  async sendByEmail(file: Express.Multer.File, excelFile: Express.Multer.File, subsidiaryName: string, inventoryId: string) {
    const inventory = await this.inventoryRepository.findOne(
      { 
        where: {id: inventoryId},
        relations: [
          'subsidiary', 
          'shipments', 
          'chargeShipments', 
          'shipments.subsidiary',
          'shipments.payment', 
          'chargeShipments.subsidiary',
          'chargeShipments.payment',
        ]
      });

    if(!inventory) {
      throw new NotFoundException(`Inventario con id ${inventoryId} no encontrado`);
    }

    this.logger.debug(`Inventario encontrado: ${inventory.id}`);

    try {
      await this.getPriorityPackages(inventory);
    } catch (err) {
      this.logger.error(`Error al enviar correo de prioridades para inventario: ${inventory.id}`, err);
      throw err;
    }


    try {
      return await this.mailService.sendHighPriorityInventoryEmail(
        file, 
        excelFile, 
        subsidiaryName, 
        inventory
      );
    } catch (err) {
      this.logger.error(`Error al enviar correo de inventario con archivos adjuntos para ${inventory.id}`, err);
      throw err;
    }
  }

  async checkInventory67BySubsidiaryResp(subsidiaryId: string) {

    const inventory = await this.inventoryRepository.findOne({
      where: {
        subsidiary: { id: subsidiaryId }
      },
      order: {
        inventoryDate: 'DESC'
      },
      select: ['id', 'inventoryDate'],
      relations: {
        shipments: {
          statusHistory: true
        }
      }
    });  

    console.log('Último inventario encontrado:', inventory);

    if (!inventory) {
      this.logger.warn(`No se encontró inventario para la sucursal con id: ${subsidiaryId}`);
      return [];
    }

    const shipmentsWithout67 = [];

    for (const shipment of inventory.shipments) {
        try {
          if (!shipment.statusHistory || shipment.statusHistory.length === 0) {
            shipmentsWithout67.push({
              trackingNumber: shipment.trackingNumber,
              currentStatus: shipment.status,
              statusHistoryCount: 0,
              exceptionCodes: [],
              firstStatusDate: null,
              lastStatusDate: null,
              comment: 'Sin historial de estados',
            });
            continue;
          }

          const sortedHistory = shipment.statusHistory.sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          );

          const hasExceptionCode67 = sortedHistory.some(status => 
            status.exceptionCode === '67'
          );

          if (!hasExceptionCode67) {
            const firstStatus = sortedHistory[0];
            const lastStatus = sortedHistory[sortedHistory.length - 1];

            const exceptionCodes = sortedHistory
              .map(h => h.exceptionCode)
              .filter(code => code !== null && code !== undefined);

            shipmentsWithout67.push({
              trackingNumber: shipment.trackingNumber,
              currentStatus: shipment.status,
              statusHistoryCount: sortedHistory.length,
              exceptionCodes: [...new Set(exceptionCodes)],
              firstStatusDate: firstStatus?.timestamp,
              lastStatusDate: lastStatus?.timestamp,
              comment: 'No tiene exceptionCode 67',
            });
          }

        } catch (error) {
          shipmentsWithout67.push({
            trackingNumber: shipment.trackingNumber,
            currentStatus: shipment.status,
            statusHistoryCount: 0,
            exceptionCodes: [],
            firstStatusDate: null,
            lastStatusDate: null,
            comment: `Error: ${error.message}`,
          });
        }
      }

      // ⚠️ FALTABA ESTE RETURN - Agrégalo al final
      return {
        summary: {
          totalShipments: inventory.shipments.length,
          withoutCode67: shipmentsWithout67.length,
          withCode67: inventory.shipments.length - shipmentsWithout67.length,
        },
        details: shipmentsWithout67
      };


    /*return { 
      inventory: inventory,
      shipments: inventory.shipments
    };*/

  }

  /**
   * MÉTODO PRINCIPAL - Corregido para relación Inventory -> shipments (array)
   */
  async checkInventory67BySubsidiary(subsidiaryId: string): Promise<{
    summary: {
      totalShipments: number;
      withoutCode67: number;
      withCode67: number;
      inventoryDate?: Date;
      percentageWithout67: number;
      inventoryId?: string;
    };
    details: ShipmentWithout67[];
  }> {
    const startTime = Date.now();
    
    try {
      // 1️⃣ OBTENER INVENTARIO MÁS RECIENTE CON SHIPMENTS
      const latestInventory = await this.getLatestInventoryWithShipments(subsidiaryId);
      
      if (!latestInventory) {
        this.logger.log(`⏱️ ${Date.now() - startTime}ms - Sin inventario`);
        return this.getEmptyResult();
      }

      console.log(`📦 Inventario ID: ${latestInventory.id}, Shipments: ${latestInventory.shipments?.length || 0}`);

      // 2️⃣ PROCESAR SHIPMENTS DEL INVENTARIO
      const { shipmentsWithout67, totalShipments } = 
        await this.processInventoryShipments(latestInventory);
      
      const withoutCode67 = shipmentsWithout67.length;
      const withCode67 = Math.max(0, totalShipments - withoutCode67);
      const percentageWithout67 = totalShipments > 0 
        ? Math.round((withoutCode67 / totalShipments) * 100 * 10) / 10 
        : 0;

      this.logger.log(`⏱️ ${Date.now() - startTime}ms - ${withoutCode67}/${totalShipments} sin código 67`);

      return {
        summary: {
          totalShipments,
          withoutCode67,
          withCode67,
          inventoryDate: latestInventory.inventoryDate,
          percentageWithout67,
          inventoryId: latestInventory.id,
        },
        details: shipmentsWithout67
      };

    } catch (error) {
      this.logger.error(`❌ Error: ${error.message}`, error.stack);
      throw error;
    }
  }

  // ============ MÉTODOS HELPER CORREGIDOS ============

  /**
   * Obtiene el inventario más reciente CON SUS SHIPMENTS
   */
  private async getLatestInventoryWithShipments(subsidiaryId: string): Promise<Inventory | null> {
    return await this.inventoryRepository.findOne({
      where: { subsidiary: { id: subsidiaryId } },
      relations: [
        'shipments',
        'shipments.statusHistory' // Cargar historial de cada shipment
      ],
      select: {
        id: true,
        inventoryDate: true,
        shipments: {
          id: true,
          trackingNumber: true,
          status: true,
          createdAt: true,
          statusHistory: {
            id: true,
            exceptionCode: true,
            timestamp: true,
          }
        }
      },
      order: { inventoryDate: 'DESC' },
    });
  }

  /**
   * Procesa los shipments del inventario
   */
  private async processInventoryShipments(inventory: Inventory): Promise<{
    shipmentsWithout67: ShipmentWithout67[];
    totalShipments: number;
  }> {
    if (!inventory.shipments || inventory.shipments.length === 0) {
      return { shipmentsWithout67: [], totalShipments: 0 };
    }

    const shipmentsWithout67: ShipmentWithout67[] = [];
    const totalShipments = inventory.shipments.length;

    // Procesar en batches para mejor rendimiento
    const BATCH_SIZE = 100;
    
    for (let i = 0; i < totalShipments; i += BATCH_SIZE) {
      const batch = inventory.shipments.slice(i, Math.min(i + BATCH_SIZE, totalShipments));
      
      for (const shipment of batch) {
        try {
          const result = this.processSingleShipment(shipment);
          if (result) {
            shipmentsWithout67.push(result);
          }
        } catch (error) {
          // Si falla un shipment, continuar con los demás
          shipmentsWithout67.push({
            trackingNumber: shipment.trackingNumber,
            currentStatus: shipment.status,
            statusHistoryCount: 0,
            exceptionCodes: [],
            firstStatusDate: null,
            lastStatusDate: null,
            daysInSystem: null,
            comment: `Error: ${error.message}`,
          });
        }
      }
    }

    return { shipmentsWithout67, totalShipments };
  }

  /**
   * Procesa un solo shipment del inventario
   */
  private processSingleShipment(shipment: any): ShipmentWithout67 | null {
    const statusHistory = shipment.statusHistory || [];
    const historyCount = statusHistory.length;

    // Verificar si tiene código 67 en su historial
    let hasCode67 = false;
    let firstStatusDate: Date | null = null;
    let lastStatusDate: Date | null = null;
    const exceptionCodes = new Set<string>();

    // Procesar historial en un solo loop
    if (historyCount > 0) {
      let minDate: Date | null = null;
      let maxDate: Date | null = null;
      
      for (const status of statusHistory) {
        // Verificar código 67
        if (status.exceptionCode === '67') {
          hasCode67 = true;
          break; // Salir temprano si encontramos código 67
        }
        
        // Recoger exception codes únicos (excluyendo null/empty)
        if (status.exceptionCode && status.exceptionCode.trim() !== '') {
          exceptionCodes.add(status.exceptionCode);
        }
        
        // Encontrar fechas mínimas y máximas
        const statusDate = new Date(status.timestamp);
        if (!minDate || statusDate < minDate) {
          minDate = statusDate;
        }
        if (!maxDate || statusDate > maxDate) {
          maxDate = statusDate;
        }
      }
      
      firstStatusDate = minDate;
      lastStatusDate = maxDate;
    }

    // Si tiene código 67, NO incluirlo
    if (hasCode67) {
      return null;
    }

    // Calcular días en sistema
    let daysInSystem: number | null = null;
    if (firstStatusDate) {
      const today = new Date();
      const diffTime = Math.abs(today.getTime() - firstStatusDate.getTime());
      daysInSystem = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }

    return {
      trackingNumber: shipment.trackingNumber,
      currentStatus: shipment.status,
      statusHistoryCount: historyCount,
      exceptionCodes: Array.from(exceptionCodes),
      firstStatusDate,
      lastStatusDate,
      daysInSystem,
      comment: historyCount === 0 
        ? 'Sin historial de estados' 
        : 'No tiene exceptionCode 67',
    };
  }

  /**
   * Resultado vacío
   */
  private getEmptyResult() {
    return {
      summary: {
        totalShipments: 0,
        withoutCode67: 0,
        withCode67: 0,
        percentageWithout67: 0,
      },
      details: []
    };
  }

  // ============ GENERADOR DE EXCEL CORREGIDO ============

  /**
   * Genera reporte Excel optimizado
   */
  async generateExcelReport(subsidiaryId: string): Promise<Buffer> {
    const startTime = Date.now();
    
    try {
      // 1. Obtener datos
      const inventoryData = await this.checkInventory67BySubsidiary(subsidiaryId);
      
      // 2. Crear workbook
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Sistema de Inventario';
      workbook.created = new Date();
      
      // 3. Agregar hojas
      this.addSummarySheet(workbook, inventoryData);
      this.addDetailsSheet(workbook, inventoryData.details);
      this.addStatisticsSheet(workbook, inventoryData);
      
      // 4. Generar buffer
      this.logger.log(`📊 Excel generado en: ${Date.now() - startTime}ms`);
      const arrayBuffer = await workbook.xlsx.writeBuffer();
      return Buffer.from(arrayBuffer);  
            
    } catch (error) {
      this.logger.error(`❌ Error generando Excel: ${error.message}`);
      throw error;
    }
  }

  /**
   * Agrega hoja de resumen
   */
  private addSummarySheet(workbook: ExcelJS.Workbook, data: any): void {
    const worksheet = workbook.addWorksheet('Resumen');
    
    // Título
    worksheet.mergeCells('A1:G1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = 'REPORTE - SHIPMENTS SIN CÓDIGO 67';
    titleCell.font = { bold: true, size: 16, color: { argb: 'FFFFFF' } };
    titleCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: '2E75B6' }
    };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    
    // Información del inventario
    const infoRows = [
      ['Fecha de generación:', new Date()],
      ['Fecha de inventario:', data.summary.inventoryDate || 'N/A'],
      ['ID Inventario:', data.summary.inventoryId || 'N/A'],
      ['Total Shipments:', data.summary.totalShipments],
      ['Sin código 67:', data.summary.withoutCode67],
      ['Con código 67:', data.summary.withCode67],
      ['Porcentaje sin 67:', `${data.summary.percentageWithout67}%`],
    ];
    
    infoRows.forEach(([label, value], index) => {
      const row = 3 + index;
      worksheet.getCell(`A${row}`).value = label;
      worksheet.getCell(`B${row}`).value = value;
      
      if (value instanceof Date) {
        worksheet.getCell(`B${row}`).numFmt = 'dd/mm/yyyy hh:mm';
      }
      
      if (typeof value === 'number' && index >= 3) {
        worksheet.getCell(`B${row}`).font = { bold: true, color: { argb: 'E46C0A' } };
      }
    });
    
    // Formato
    worksheet.columns = [
      { width: 25 },
      { width: 25 },
    ];
    
    // Ajustar alturas
    for (let i = 1; i <= 10; i++) {
      worksheet.getRow(i).height = 25;
    }
  }

  /**
   * Agrega hoja de detalles
   */
  private addDetailsSheet(workbook: ExcelJS.Workbook, details: ShipmentWithout67[]): void {
    const worksheet = workbook.addWorksheet('Detalles');
    
    // Encabezados
    const headers = [
      { header: 'No.', key: 'index', width: 8 },
      { header: 'Tracking Number', key: 'trackingNumber', width: 25 },
      { header: 'Estado', key: 'currentStatus', width: 20 },
      { header: 'Historial', key: 'statusHistoryCount', width: 12 },
      { header: 'Códigos', key: 'exceptionCodes', width: 25 },
      { header: 'Primera Fecha', key: 'firstStatusDate', width: 22 },
      { header: 'Última Fecha', key: 'lastStatusDate', width: 22 },
      { header: 'Días', key: 'daysInSystem', width: 10 },
      { header: 'Comentario', key: 'comment', width: 30 },
    ];
    
    worksheet.columns = headers.map(h => ({
      header: h.header,
      key: h.key,
      width: h.width
    }));
    
    // Estilo encabezados
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: '5B9BD5' }
    };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
    headerRow.height = 30;
    
    // Agregar datos
    details.forEach((item, index) => {
      const rowNumber = index + 2;
      const row = worksheet.getRow(rowNumber);
      
      // Datos
      row.getCell('index').value = index + 1;
      row.getCell('trackingNumber').value = item.trackingNumber;
      row.getCell('currentStatus').value = item.currentStatus;
      row.getCell('statusHistoryCount').value = item.statusHistoryCount;
      row.getCell('exceptionCodes').value = item.exceptionCodes.join(', ');
      
      // Fechas formateadas
      if (item.firstStatusDate) {
        const date = new Date(item.firstStatusDate);
        row.getCell('firstStatusDate').value = date;
        row.getCell('firstStatusDate').numFmt = 'dd/mm/yyyy hh:mm';
      }
      
      if (item.lastStatusDate) {
        const date = new Date(item.lastStatusDate);
        row.getCell('lastStatusDate').value = date;
        row.getCell('lastStatusDate').numFmt = 'dd/mm/yyyy hh:mm';
      }
      
      // Días
      if (item.daysInSystem !== null) {
        row.getCell('daysInSystem').value = item.daysInSystem;
        row.getCell('daysInSystem').numFmt = '0';
      }
      
      // Comentario
      row.getCell('comment').value = item.comment;
      
      // Color alternado
      if (rowNumber % 2 === 0) {
        row.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'F2F2F2' }
        };
      }
      
      // Bordes
      headers.forEach((_, colIndex) => {
        row.getCell(colIndex + 1).border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });
    });
    
    // Congelar encabezados y auto-filtro
    worksheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];
    worksheet.autoFilter = 'A1:I1';
  }

  /**
   * Agrega hoja de estadísticas
   */
  private addStatisticsSheet(workbook: ExcelJS.Workbook, data: any): void {
    const worksheet = workbook.addWorksheet('Estadísticas');
    
    // Título
    worksheet.mergeCells('A1:C1');
    worksheet.getCell('A1').value = 'ESTADÍSTICAS';
    worksheet.getCell('A1').font = { bold: true, size: 14 };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };
    
    // Distribución por estado
    const statusStats = this.calculateStatusStats(data.details);
    
    worksheet.getCell('A3').value = 'Distribución por Estado';
    worksheet.getCell('A3').font = { bold: true };
    
    worksheet.getCell('A4').value = 'Estado';
    worksheet.getCell('B4').value = 'Cantidad';
    worksheet.getCell('C4').value = 'Porcentaje';
    
    let row = 5;
    statusStats.forEach(stat => {
      worksheet.getCell(`A${row}`).value = stat.status;
      worksheet.getCell(`B${row}`).value = stat.count;
      worksheet.getCell(`C${row}`).value = `${stat.percentage}%`;
      row++;
    });
    
    // Distribución por días
    const dayStats = this.calculateDayStats(data.details);
    
    worksheet.getCell('A' + (row + 2)).value = 'Distribución por Días en Sistema';
    worksheet.getCell('A' + (row + 2)).font = { bold: true };
    
    worksheet.getCell('A' + (row + 3)).value = 'Rango';
    worksheet.getCell('B' + (row + 3)).value = 'Cantidad';
    
    let dayRow = row + 4;
    dayStats.forEach(stat => {
      worksheet.getCell(`A${dayRow}`).value = stat.range;
      worksheet.getCell(`B${dayRow}`).value = stat.count;
      dayRow++;
    });
    
    // Formato
    worksheet.columns = [
      { width: 25 },
      { width: 15 },
      { width: 15 },
    ];
  }

  /**
   * Calcula estadísticas por estado
   */
  private calculateStatusStats(details: ShipmentWithout67[]): Array<{
    status: string;
    count: number;
    percentage: number;
  }> {
    const statusMap = new Map<string, number>();
    
    details.forEach(item => {
      const count = statusMap.get(item.currentStatus) || 0;
      statusMap.set(item.currentStatus, count + 1);
    });
    
    const total = details.length;
    return Array.from(statusMap.entries())
      .map(([status, count]) => ({
        status,
        count,
        percentage: total > 0 ? Math.round((count / total) * 100 * 10) / 10 : 0
      }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Calcula estadísticas por días
   */
  private calculateDayStats(details: ShipmentWithout67[]): Array<{
    range: string;
    count: number;
  }> {
    const ranges = [
      { range: '0-7 días', min: 0, max: 7 },
      { range: '8-30 días', min: 8, max: 30 },
      { range: '31-90 días', min: 31, max: 90 },
      { range: '91-180 días', min: 91, max: 180 },
      { range: 'Más de 180 días', min: 181, max: Infinity },
      { range: 'Sin fecha', min: -1, max: -1 },
    ];
    
    const counts = new Array(ranges.length).fill(0);
    
    details.forEach(item => {
      const days = item.daysInSystem;
      
      if (days === null || days === undefined) {
        counts[5]++; // Sin fecha
      } else {
        for (let i = 0; i < ranges.length - 1; i++) {
          if (days >= ranges[i].min && days <= ranges[i].max) {
            counts[i]++;
            break;
          }
        }
      }
    });
    
    return ranges.map((range, index) => ({
      range: range.range,
      count: counts[index]
    }));
  }

  // ============ MÉTODO DE DESCARGA ============

  /**
   * Genera y prepara archivo para descarga
   */
  async downloadExcelReport(
    subsidiaryId: string, 
    subsidiaryName?: string
  ): Promise<{ buffer: Buffer; fileName: string; mimeType: string }> {
    
    const buffer = await this.generateExcelReport(subsidiaryId);
    
    // Generar nombre de archivo
    const timestamp = new Date()
      .toISOString()
      .replace(/[:\-T.]/g, '')
      .slice(0, 14);
    
    const namePart = subsidiaryName 
      ? subsidiaryName.replace(/[^a-z0-9]/gi, '_').slice(0, 30)
      : `sucursal_${subsidiaryId.slice(0, 8)}`;
    
    const fileName = `sin_codigo_67_${namePart}_${timestamp}.xlsx`;
    
    return {
      buffer,
      fileName,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    };
  }

}

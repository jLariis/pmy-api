import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CreateInventoryDto } from './dto/create-inventory.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Inventory } from 'src/entities/inventory.entity';
import { In, Not, Repository } from 'typeorm';
import { ChargeShipment, Consolidated, Shipment, Subsidiary } from 'src/entities';
import { ValidatedPackageDispatchDto } from 'src/package-dispatch/dto/validated-package-dispatch.dto';
import { MailService } from 'src/mail/mail.service';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';

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
        to: 'paqueteriaymensajeriadelyaqui@hotmail.com',
        cc: ['sistemas@paqueteriaymensajeriadelyaqui.com','bodegacsl@paqueteriaymensajeriadelyaqui.com'],
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
}

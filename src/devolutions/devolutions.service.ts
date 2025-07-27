import { Injectable, Logger } from '@nestjs/common';
import { CreateDevolutionDto } from './dto/create-devolution.dto';
import { Repository } from 'typeorm';
import { Devolution } from 'src/entities/devolution.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { ChargeShipment, Income, Shipment } from 'src/entities';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { ValidateShipmentDto } from './dto/valiation-devolution.dto';

@Injectable()
export class DevolutionsService {
  private readonly logger = new Logger(DevolutionsService.name);

  constructor(
    @InjectRepository(Devolution)
    private readonly devolutionRepository: Repository<Devolution>,
    @InjectRepository(Shipment)
    private readonly shipmentRepository: Repository<Shipment>,
    @InjectRepository(Income)
    private readonly incomeRepository: Repository<Income>,
    @InjectRepository(ChargeShipment)
    private readonly chargeShipmentRepository: Repository<ChargeShipment>
  ) {}

  async create(devolutions: CreateDevolutionDto[]): Promise<{
    success: Devolution[];
    duplicates: string[];
    notFound: string[];
    errors: Array<{ trackingNumber: string; error: string }>;
  }> {
    const success: Devolution[] = [];
    const duplicates: string[] = [];
    const notFound: string[] = [];
    const errors: Array<{ trackingNumber: string; error: string }> = [];

    for (const dto of devolutions) {
      const { trackingNumber } = dto;
      
      try {
        this.logger.log(`Procesando devolución para tracking: ${trackingNumber}`);

        // 1. Validar si la devolución ya existe
        const existingDevolution = await this.devolutionRepository.findOneBy({ trackingNumber });
        if (existingDevolution) {
          duplicates.push(trackingNumber);
          this.logger.warn(`Devolución duplicada: ${trackingNumber}`);
          continue;
        }

        // 2. Crear nueva devolución
        const newDevolution = this.devolutionRepository.create({
          ...dto,
          date: new Date()
        });

        const savedDevolution = await this.devolutionRepository.save(newDevolution);
        success.push(savedDevolution);
        this.logger.log(`Devolución creada ID: ${savedDevolution.id}`);

        // 3. Actualizar estado (shipment o charge_shipment)
        try {
          // Intentar actualizar shipment primero
          let updateResult = await this.shipmentRepository.update(
            { trackingNumber },
            { 
              status: ShipmentStatusType.DEVUELTO_A_FEDEX,
            }
          );

          // Si no se encontró en shipment, buscar en charge_shipment
          if (updateResult.affected === 0) {
            updateResult = await this.chargeShipmentRepository.update(
              { trackingNumber },
              { 
                status: ShipmentStatusType.DEVUELTO_A_FEDEX,
              }
            );

            if (updateResult.affected === 0) {
              notFound.push(trackingNumber);
              this.logger.warn(`No encontrado en shipment ni charge_shipment: ${trackingNumber}`);
            } else {
              this.logger.log(`ChargeShipment actualizado: ${trackingNumber}`);
            }
          } else {
            this.logger.log(`Shipment actualizado: ${trackingNumber}`);
          }
        } catch (updateError) {
          this.logger.error(`Error al actualizar estado: ${trackingNumber}`, updateError.stack);
          errors.push({ 
            trackingNumber, 
            error: `Error actualizando estado: ${updateError.message}` 
          });
        }

        /* 
        // 4. Validación y eliminación de income (pendiente)
        try {
          // Lógica especial para income vendrá aquí
        } catch (incomeError) {
          this.logger.error(`Error procesando income: ${trackingNumber}`, incomeError.stack);
          errors.push({
            trackingNumber,
            error: `Error procesando income: ${incomeError.message}`
          });
        }
        */

      } catch (error) {
        const errorMessage = `Error procesando devolución ${trackingNumber}: ${error.message}`;
        this.logger.error(errorMessage, error.stack);
        errors.push({ trackingNumber, error: errorMessage });
      }
    }

    // Reporte final
    this.logger.log(`
      Resultado final:
      - Creadas: ${success.length}
      - Duplicadas: ${duplicates.length}
      - No encontradas: ${notFound.length}
      - Errores: ${errors.length}
    `);

    return { 
      success, 
      duplicates, 
      notFound,
      errors 
    };
  }

  async findAll(subsidiaryId: string) {
    return await this.devolutionRepository.find({
      where: {
        subsidiary: {
          id: subsidiaryId
        }
      }
    });
  }

  async validateOnShipment(trackingNumber: string): Promise<ValidateShipmentDto | null> {
    // 1. Primero buscamos en Shipment normal
    const regularShipment = await this.shipmentRepository.findOne({
      where: { trackingNumber },
      relations: ['subsidiary', 'statusHistory'],
      select: {
        id: true,
        trackingNumber: true,
        status: true,
        subsidiary: {
          id: true,  // <-- Agregado
          name: true,
        },
        statusHistory: {
          id: true,
          status: true,
          exceptionCode: true,
          notes: true,
          createdAt: true,
        },
      },
      order: {
        statusHistory: {
          createdAt: 'DESC',
        },
      },
    });

    if (regularShipment) {
      const incomeExists = await this.incomeRepository.exists({
        where: { trackingNumber },
      });

      const lastStatus = regularShipment.statusHistory?.[0];
      
      return {
        id: regularShipment.id,
        trackingNumber: regularShipment.trackingNumber,
        status: regularShipment.status,
        subsidiaryId: regularShipment.subsidiary.id,  // <-- Agregado
        subsidiaryName: regularShipment.subsidiary.name,
        hasIncome: incomeExists,
        isCharge: false,
        lastStatus: lastStatus ? {
          type: lastStatus.status,
          exceptionCode: lastStatus.exceptionCode || null,
          notes: lastStatus.notes
        } : null,
      };
    }

    // 2. Si no se encuentra en Shipment, buscamos en ChargeShipment
    const chargeShipment = await this.chargeShipmentRepository.findOne({
      where: { trackingNumber },
      relations: ['subsidiary'],
      select: {
        id: true,
        trackingNumber: true,
        status: true,
        exceptionCode: true,
        subsidiary: {
          id: true,  // <-- Agregado
          name: true,
        },
      },
    });

    if (!chargeShipment) {
      return null;
    }

    const incomeExists = await this.incomeRepository.exists({
      where: { trackingNumber },
    });

    return {
      id: chargeShipment.id,
      trackingNumber: chargeShipment.trackingNumber,
      status: chargeShipment.status,
      subsidiaryId: chargeShipment.subsidiary.id,  // <-- Agregado
      subsidiaryName: chargeShipment.subsidiary.name,
      hasIncome: incomeExists,
      isCharge: true,
      lastStatus: {
        type: chargeShipment.status || null,
        exceptionCode: chargeShipment.exceptionCode || null,
        notes: null
      },
    };
  }
}

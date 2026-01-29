import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CollectionDto } from './dto/collection.dto';
import { FedexService } from 'src/shipments/fedex.service';
import { FedExTrackingResponseDto } from 'src/shipments/dto/fedex/fedex-tracking-response.dto';
import { IncomeSourceType } from 'src/common/enums/income-source-type.enum';
import { IncomeStatus } from 'src/common/enums/income-status.enum';
import { ShipmentType } from 'src/common/enums/shipment-type.enum';
import { Income, Collection, Subsidiary } from 'src/entities';

@Injectable()
export class CollectionsService {
  private readonly logger = new Logger(CollectionsService.name);

  constructor(
      @InjectRepository(Collection)
      private collectionRepository: Repository<Collection>,
      @InjectRepository(Income)
      private incomeRepository: Repository<Income>,
      @InjectRepository(Subsidiary)
      private subsidiaryRepository: Repository<Subsidiary>,
      private readonly fedexService: FedexService
    ){}


    async save(collectionDto: CollectionDto[]): Promise<{
      savedCollections: Collection[];
      duplicates: string[];
      errors: Array<{ trackingNumber: string; error: string }>;
    }> {
      const savedCollections: Collection[] = [];
      const duplicates: string[] = [];
      const errors: Array<{ trackingNumber: string; error: string }> = [];

      try {
        // 1. Validar y filtrar colecciones duplicadas
        const uniqueCollections = [];
        
        for (const dto of collectionDto) {
          const existingCollection = await this.collectionRepository.findOneBy({ 
            trackingNumber: dto.trackingNumber 
          });

          if (existingCollection) {
            duplicates.push(dto.trackingNumber);
            this.logger.warn(`Collection duplicada - Tracking: ${dto.trackingNumber}`);
            continue;
          }
          uniqueCollections.push(dto);
        }

        // 2. Crear y guardar collections
        const newCollections = this.collectionRepository.create(uniqueCollections);
        const savedCollections = await this.collectionRepository.save(newCollections);
        this.logger.log(`Se guardaron ${savedCollections.length} collections`);

        // 3. Validar que se guardó al menos una collection
        if (savedCollections.length === 0) {
          this.logger.warn('No se guardaron collections, todas eran duplicadas');
          return { savedCollections: [], duplicates, errors };
        }

        // 4. Obtener subsidiaria (con validación)
        const subsidiaryId = savedCollections[0].subsidiary.id;
        const subsidiary = await this.subsidiaryRepository.findOneBy({ id: subsidiaryId });
        
        if (!subsidiary) {
          throw new Error(`Subsidiaria no encontrada con ID: ${subsidiaryId}`);
        }

        // 5. Crear incomes (con manejo de errores)
        try {
          const newIncomes = savedCollections.map((collection) => {
            return this.incomeRepository.create({
              subsidiary,
              trackingNumber: collection.trackingNumber,
              shipmentType: ShipmentType.FEDEX,
              incomeType: IncomeStatus.ENTREGADO,
              cost: subsidiary.fedexCostPackage,
              isGrouped: false,
              sourceType: IncomeSourceType.COLLECTION,
              collection: { id: collection.id },
              date: new Date(), // Usar fecha actual en lugar de createdAt
            });
          });

          await this.incomeRepository.save(newIncomes);
          this.logger.log(`Se crearon ${newIncomes.length} incomes`);
        } catch (incomeError) {
          this.logger.error('Error al crear incomes', incomeError.stack);
          errors.push({
            trackingNumber: 'VARIOS',
            error: `Error al crear incomes: ${incomeError.message}`
          });
        }

        return { savedCollections, duplicates, errors };

      } catch (error) {
        this.logger.error('Error en el proceso save', error.stack);
        errors.push({
          trackingNumber: 'GLOBAL',
          error: `Error general: ${error.message}`
        });
        return { savedCollections: [], duplicates, errors };
      }
    }

    async getByTrackingNumber(trackingNumber: string){
      return await this.collectionRepository.findOneBy({trackingNumber});
    }

    async getAll(subsidiary: string) {
      return this.collectionRepository.find({
        where: {
          subsidiary: {
            id: subsidiary
          }
        }})
    }

    async validateHavePickUpEventResp(trackingNumber: string): Promise<{
      isPickUp: boolean;
      status: string | null;
    }> {
      try {
        if (!trackingNumber) {
          throw new BadRequestException('Tracking number is required');
        }

        const fedexData: FedExTrackingResponseDto = await this.fedexService.trackPackage(trackingNumber);

        const scanEvents = fedexData?.output?.completeTrackResults?.[0]?.trackResults?.[0]?.scanEvents;

        if (!Array.isArray(scanEvents) || scanEvents.length === 0) {
          return {
            isPickUp: false,
            status: null,
          };
        }

        // Buscar el evento PU (Pickup)
        const pickupEvent = scanEvents.find(event => event.eventType === 'PU');

        if (pickupEvent) {
          return {
            isPickUp: true,
            status: pickupEvent.eventType, // Puedes usar pickupEvent.eventDescription si prefieres
          };
        }

        return {
          isPickUp: false,
          status: null,
        };
      } catch (error) {
        throw new BadRequestException(
          `Failed to validate pickup event for tracking number ${trackingNumber}: ${error.message}`
        );
      }
    }

    async validateHavePickUpEvent(trackingNumber: string): Promise<{
      isPickUp: boolean;
      status: string | null;
      description: string | null;
    }> {
      try {
        if (!trackingNumber) {
          throw new BadRequestException('Tracking number is required');
        }

        const fedexData: FedExTrackingResponseDto = await this.fedexService.trackPackage(trackingNumber);
        const trackResult = fedexData?.output?.completeTrackResults?.[0]?.trackResults?.[0];
        const scanEvents = trackResult?.scanEvents;

        if (!Array.isArray(scanEvents) || scanEvents.length === 0) {
          return { isPickUp: false, status: null, description: null };
        }

        /**
         * Códigos de éxito que confirman que FedEx ya tiene el paquete:
         * PU: Picked Up (Recolección en domicilio)
         * DP: Dropped Off (Cliente lo dejó en sucursal)
         * AR: Arrival at FedEx Location (Llegó a la primera estación)
         * OC: Order Created / Pickup confirmed (En ciertos servicios internacionales)
         * IT: In Transit (Si ya está en tránsito, obviamente ya se recolectó)
         */
        const SUCCESS_CODES = ['PU', 'DP', 'AR', 'OC', 'IT'];

        // Buscamos el primer evento que coincida con nuestra lista de éxito
        // Usamos .reverse() porque queremos el evento más reciente que confirme la posesión
        const pickupEvent = [...scanEvents]
          .reverse()
          .find(event => SUCCESS_CODES.includes(event.eventType));

        if (pickupEvent) {
          return {
            isPickUp: true,
            status: pickupEvent.eventType,
            description: pickupEvent.eventDescription || 'Package in FedEx custody',
          };
        }

        // Opcional: Si no hay evento en el historial, pero el estatus actual dice que ya está en camino
        const currentStatus = trackResult?.latestStatusDetail?.code;
        if (currentStatus && SUCCESS_CODES.includes(currentStatus)) {
            return {
                isPickUp: true,
                status: currentStatus,
                description: trackResult?.latestStatusDetail?.description || 'In Transit',
            };
        }

        return { isPickUp: false, status: null, description: null };

      } catch (error) {
        throw new BadRequestException(
          `Failed to validate pickup event for tracking number ${trackingNumber}: ${error.message}`
        );
      }
    }


}

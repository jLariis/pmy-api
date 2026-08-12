import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
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
      private readonly fedexService: FedexService,
      private readonly dataSource: DataSource,
    ){}


    async save(collectionDto: CollectionDto[], userId?: string): Promise<{
      savedCollections: Collection[];
      duplicates: string[];
      errors: Array<{ trackingNumber: string; error: string }>;
    }> {
      const duplicates: string[] = [];
      const errors: Array<{ trackingNumber: string; error: string }> = [];

      const queryRunner = this.dataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();

      try {
        const result = await this.saveCollectionsWithManager(queryRunner.manager, collectionDto, { userId });
        duplicates.push(...result.duplicates);
        // 6. Commit atómico: o se guardan recolecciones + ingresos juntos, o nada.
        await queryRunner.commitTransaction();
        return { savedCollections: result.savedCollections, duplicates, errors };
      } catch (error) {
        await queryRunner.rollbackTransaction();
        this.logger.error('Error en el proceso save (rollback aplicado)', error.stack);
        errors.push({
          trackingNumber: 'GLOBAL',
          error: `Error general: ${error.message}`,
        });
        return { savedCollections: [], duplicates, errors };
      } finally {
        await queryRunner.release();
      }
    }

    /**
     * Guarda recolecciones + sus ingresos sobre el `manager` recibido (sin transacción propia),
     * para reusarlo en `save()` y en el guardado unificado de una "Salida" (todo en una sola
     * transacción). Enlaza `returningHistoryId` si se provee. Lanza ante error inesperado (el
     * caller decide el rollback); los duplicados se saltan y se devuelven.
     */
    async saveCollectionsWithManager(
      manager: EntityManager,
      collectionDto: CollectionDto[],
      opts: { userId?: string; returningHistoryId?: string } = {},
    ): Promise<{ savedCollections: Collection[]; duplicates: string[] }> {
      const duplicates: string[] = [];

      // 1. Validar y filtrar colecciones duplicadas (por trackingNumber existente).
      const uniqueCollections: CollectionDto[] = [];
      for (const dto of collectionDto) {
        const existingCollection = await manager.findOneBy(Collection, {
          trackingNumber: dto.trackingNumber,
        });
        if (existingCollection) {
          duplicates.push(dto.trackingNumber);
          this.logger.warn(`Collection duplicada - Tracking: ${dto.trackingNumber}`);
          continue;
        }
        uniqueCollections.push(dto);
      }

      if (uniqueCollections.length === 0) {
        this.logger.warn('No se guardaron collections, todas eran duplicadas');
        return { savedCollections: [], duplicates };
      }

      // 2. Crear y guardar collections (enlazadas a la salida si aplica).
      const newCollections = manager.create(
        Collection,
        uniqueCollections.map((dto) => ({
          ...dto,
          createdById: opts.userId ?? null,
          returningHistory: opts.returningHistoryId ? ({ id: opts.returningHistoryId } as any) : null,
        })),
      );
      const savedCollections = await manager.save(newCollections);
      this.logger.log(`Se guardaron ${savedCollections.length} collections`);

      // 3. Resolver las sucursales involucradas (puede haber más de una en el lote).
      const subsidiaryIds = [
        ...new Set(savedCollections.map((c) => c.subsidiary?.id).filter(Boolean)),
      ];
      const subsidiaries = subsidiaryIds.length
        ? await manager.find(Subsidiary, { where: { id: In(subsidiaryIds) } })
        : [];
      const subsidiaryById = new Map(subsidiaries.map((s) => [s.id, s]));

      // 4. Crear incomes — uno por recolección, con la sucursal/costo correctos.
      const newIncomes = savedCollections.map((collection) => {
        const subsidiary = subsidiaryById.get(collection.subsidiary?.id);
        if (!subsidiary) {
          throw new Error(
            `Sucursal no encontrada (id: ${collection.subsidiary?.id}) para la recolección ${collection.trackingNumber}`,
          );
        }
        return manager.create(Income, {
          subsidiary,
          trackingNumber: collection.trackingNumber,
          shipmentType: ShipmentType.FEDEX,
          incomeType: IncomeStatus.ENTREGADO,
          cost: subsidiary.fedexCostPackage,
          isGrouped: false,
          sourceType: IncomeSourceType.COLLECTION,
          collection: { id: collection.id },
          date: new Date(),
          createdById: opts.userId ?? null,
        });
      });
      await manager.save(newIncomes);
      this.logger.log(`Se crearon ${newIncomes.length} incomes`);

      return { savedCollections, duplicates };
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
        const SUCCESS_CODES = ['PU'];

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

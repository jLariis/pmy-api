import { BadRequestException, Injectable } from '@nestjs/common';
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
  
  constructor(
      @InjectRepository(Collection)
      private collectionRepository: Repository<Collection>,
      @InjectRepository(Income)
      private incomeRepository: Repository<Income>,
      @InjectRepository(Subsidiary)
      private subsidiaryRepository: Repository<Subsidiary>,
      private readonly fedexService: FedexService
    ){}


    async save(collectionDto: CollectionDto[]): Promise<Collection[]> {
      // Crear las nuevas collections (objetos sin guardar aún)
      const newCollections = this.collectionRepository.create(collectionDto);

      // Guardar las collections en base de datos (retorna collections con id asignado)
      const savedCollections = await this.collectionRepository.save(newCollections);

      // Obtener la subsidiaria (asumo que todas las collections tienen la misma)
      const subsidiary = await this.subsidiaryRepository.findOneBy({id: savedCollections[0].subsidiary.id})
  
      // Crear un array para guardar los incomes que vamos a crear
      const newIncomes = savedCollections.map((collection) => {
        return this.incomeRepository.create({
          subsidiary,
          trackingNumber: collection.trackingNumber,
          shipmentType: ShipmentType.FEDEX, // Esto depende de tu lógica, ¿es siempre FEDEX?
          incomeType: IncomeStatus.ENTREGADO,
          cost: subsidiary.fedexCostPackage,
          isGrouped: false,
          sourceType: IncomeSourceType.COLLECTION,
          collection: {id: collection.id}, // Relación con la collection ya guardada
          date: savedCollections[0].createdAt,
        });
      });

      // Guardar todos los incomes en base de datos
      await this.incomeRepository.save(newIncomes);

      // Retornar las collections guardadas
      return savedCollections;
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

    async validateHavePickUpEvent(trackingNumber: string): Promise<{
      isPickUp: boolean;
      status: string | null;
    }> {
      try {
        // Validate tracking number
        if (!trackingNumber) {
          throw new BadRequestException('Tracking number is required');
        }

        // Fetch tracking data from FedEx
        const fedexData: FedExTrackingResponseDto = await this.fedexService.trackPackage(trackingNumber);

        // Safely access scanEvents
        const scanEvents = fedexData?.output?.completeTrackResults?.[0]?.trackResults?.[0]?.scanEvents;

        if (!scanEvents || !Array.isArray(scanEvents) || scanEvents.length === 0) {
          return {
            isPickUp: false,
            status: null,
          };
        }

        // Check if there's a pickup event
        const isPickUp = scanEvents.some(event => event.eventType === 'PU');

        // Sort events by date (descending) to get the latest event
        const latestEvent = scanEvents.sort((a, b) => {
          return new Date(b.date).getTime() - new Date(a.date).getTime();
        })[0];

        // Return the result
        return {
          isPickUp,
          status: latestEvent?.eventType || null, // Or use eventDescription if preferred
        };
      } catch (error) {
        // Handle FedEx API errors or other issues
        throw new BadRequestException(
          `Failed to validate pickup event for tracking number ${trackingNumber}: ${error.message}`
        );
      }
    }

}

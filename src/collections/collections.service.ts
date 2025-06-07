import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Collection } from 'src/entities/collection.entity';
import { Repository } from 'typeorm';
import { CollectionDto } from './dto/collection.dto';
import { FedexService } from 'src/shipments/fedex.service';
import { FedExTrackingResponseDto } from 'src/shipments/dto/fedex/fedex-tracking-response.dto';

@Injectable()
export class CollectionsService {
  
  constructor(
      @InjectRepository(Collection)
      private collectionRepository: Repository<Collection>,
      private readonly fedexService: FedexService
    ){}


    async save(collectionDto: CollectionDto[]): Promise<Collection[]> {
      return await this.collectionRepository.save(collectionDto);
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

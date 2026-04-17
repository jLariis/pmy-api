import { Injectable, NotFoundException } from '@nestjs/common';
import { CreatePickUpDto } from './dto/create-pick-up.dto';
import { UpdatePickUpDto } from './dto/update-pick-up.dto';
import { ChargeShipment } from 'src/entities/charge-shipment.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Shipment } from 'src/entities';
import { FedexService } from 'src/shipments/fedex.service';
import { ForPickUp } from 'src/entities/for-pick-up.entity';
import { TrackingInfoDto } from './dto/tracking-info.dto';

@Injectable()
export class PickUpService {
  constructor(
    @InjectRepository(Shipment)
    private shipmentRepository: Repository<Shipment>,
    @InjectRepository(ChargeShipment)
    private chargeShipmentRepository: Repository<ChargeShipment>,
    @InjectRepository(ForPickUp)
    private forPickUpRepository: Repository<ForPickUp>,
    private readonly fedexService: FedexService,
  ) {}

  async create(createPickUpDto: CreatePickUpDto) {
    const newPickUp = await this.forPickUpRepository.create(createPickUpDto);
    return await this.forPickUpRepository.save(newPickUp);
  }

  async findAll() {
    return await this.forPickUpRepository.find({
      order: {
        date: 'DESC'
      }
    });
  }

  async findByTrackingNumber(trackingNumber: string) {
    const shipmentData = await this.shipmentRepository.findOne({
      where: { trackingNumber }
    });

    const chargeShipmentData = !shipmentData
      ? await this.chargeShipmentRepository.findOne({
          where: { trackingNumber }
        })
      : null;

    if (!shipmentData && !chargeShipmentData) {
      throw new NotFoundException('Tracking number not found');
    }

    const entity = shipmentData || chargeShipmentData;
    const isCharge = !shipmentData;

    const pickUpData: TrackingInfoDto = {
      id: entity.id,
      trackingNumber: entity.trackingNumber,
      carrierCode: entity.carrierCode,
      fedexUniqueId: entity.fedexUniqueId,
      consNumber: entity.consNumber,
      consolidatedId: entity.consolidatedId,
      commitDateTime: entity.commitDateTime,
      isHighValue: entity.isHighValue,
      priority: entity.priority,
      receivedByName: entity.receivedByName,
      recipientAddress: entity.recipientAddress,
      recipientCity: entity.recipientCity,
      recipientName: entity.recipientName,
      recipientPhone: entity.recipientPhone,
      recipientZip: entity.recipientZip,
      shipmentType: entity.shipmentType,
      status: entity.status,
      isCharge,
    };

    return pickUpData;
  }

  findOne(id: number) {
    return `This action returns a #${id} pickUp`;
  }

  update(id: number, updatePickUpDto: UpdatePickUpDto) {
    return `This action updates a #${id} pickUp`;
  }

  remove(id: number) {
    return `This action removes a #${id} pickUp`;
  }
}

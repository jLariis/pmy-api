import { Injectable } from '@nestjs/common';
import { CreatePackageDispatchDto } from './dto/create-package-dispatch.dto';
import { UpdatePackageDispatchDto } from './dto/update-package-dispatch.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { PackageDispatch } from 'src/entities/package-dispatch.entity';
import { In, Repository } from 'typeorm';
import { create } from 'domain';
import { Shipment, ChargeShipment, Consolidated } from 'src/entities';
import { remove } from 'winston';
import { ValidatedPackageDispatchDto } from './dto/validated-package-dispatch.dto';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { Devolution } from 'src/entities/devolution.entity';

@Injectable()
export class PackageDispatchService {

  constructor(
    @InjectRepository(PackageDispatch)
    private readonly packageDispatchRepository: Repository<PackageDispatch>,
    @InjectRepository(Shipment)
    private readonly shipmentRepository: Repository<Shipment>,
    @InjectRepository(ChargeShipment)
    private readonly chargeShipmentRepository: Repository<ChargeShipment>,
    @InjectRepository(Consolidated)
    private readonly consolidatedRepository: Repository<Consolidated>,
    @InjectRepository(Devolution)
    private readonly devolutionRepository: Repository<Devolution>,
  ){

  }

  async create(dto: CreatePackageDispatchDto): Promise<PackageDispatch> {
    // Resolve shipment IDs to Shipment entities
    const shipments = await this.shipmentRepository.find({
      where: { id: In(dto.shipments) },
    });

    if (shipments.length !== dto.shipments.length) {
      throw new Error('Some shipment IDs were not found');
    }

    // Create and save the PackageDispatch entity without trackingNumber
    const newPackageDispatch = this.packageDispatchRepository.create({
      routes: dto.routes || [],
      drivers: dto.drivers || [],
      vehicle: dto.vehicle,
      subsidiary: dto.subsidiary,
    });

    const savedDispatch = await this.packageDispatchRepository.save(newPackageDispatch);

    // Update shipments relationship
    await this.shipmentRepository
      .createQueryBuilder()
      .relation(PackageDispatch, 'shipments')
      .of(savedDispatch)
      .add(shipments);

    return savedDispatch;
  }

  async validatePackage(
    packageToValidate: ValidatedPackageDispatchDto,
    subsidiaryId: string
  ): Promise<ValidatedPackageDispatchDto> {
    let isValid = true;
    let reason = '';

    const existePackageOnPackageDispatch = await this.packageDispatchRepository
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
    .getRawOne();

    const existPackageOnReturn = await this.devolutionRepository.findOne({
      where: { trackingNumber: packageToValidate.trackingNumber },
    })

    if (existePackageOnPackageDispatch) {
      isValid = false;
      reason = 'El paquete ya existe en otra salida a ruta';
    }

    if(existPackageOnReturn) {
      isValid = false;
      reason = 'El paquete existe en una devolución';
    }

    if (packageToValidate.subsidiary.id !== subsidiaryId) {
      isValid = false;
      reason = 'El paquete no pertenece a la sucursal actual';
    }

    if (packageToValidate.status === ShipmentStatusType.ENTREGADO) {
      isValid = false;
      reason = 'El paquete ya ha sido entregado';
    }

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
      where: { trackingNumber },
      relations: ['subsidiary', 'statusHistory', 'payment'],
    });

    if (!shipment) {
      const chargeShipment = await this.chargeShipmentRepository.findOne({
        where: { trackingNumber },
        relations: ['subsidiary', 'charge'],
      });

      if (!chargeShipment) {
        throw new Error('Shipment not found with the provided tracking number');
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
      },
      subsidiaryId
    );

    return {
      ...validatedShipment,
      consolidated,
    };
  }

  findAll() {
    return `This action returns all packageDispatch`;
  }

  async findAllBySubsidiary(subsidiaryId: string) {
    return await this.packageDispatchRepository.find({
      where: { subsidiary: { id: subsidiaryId } },
      relations: ['shipments', 'routes', 'drivers', 'vehicle'],
    });
  }

  findOne(id: string) {
    return `This action returns a #${id} packageDispatch`;
  }

  update(id: string, updatePackageDispatchDto: UpdatePackageDispatchDto) {
    return `This action updates a #${id} packageDispatch`;
  }

  remove(id: string) {
    return `This action removes a #${id} packageDispatch`;
  }
}

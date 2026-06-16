import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Shipment, ShipmentStatus, ChargeShipment, Subsidiary, PackageTransfer } from 'src/entities';
import { CreatePackageTransferDto } from './dto/create-package-transfer.dto';

@Injectable()
export class PackageTransferService {
  constructor(
    @InjectRepository(Shipment)
    private readonly shipmentRepository: Repository<Shipment>,
    @InjectRepository(ChargeShipment)
    private readonly chargeShipmentRepository: Repository<ChargeShipment>,
    @InjectRepository(Subsidiary)
    private readonly subsidiaryRepository: Repository<Subsidiary>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Mueve un paquete mal enrutado a la sucursal destino:
   *  - Cambia `subsidiary` del shipment/chargeShipment (mantiene el estatus).
   *  - Escribe historial con nota del traspaso.
   *  - Registra el traspaso en `package_transfer`.
   * Todo en una transacción.
   */
  async create(dto: CreatePackageTransferDto, userId?: string) {
    const trackingNumber = (dto.trackingNumber || '').trim();
    if (!trackingNumber) throw new BadRequestException('Falta el número de guía.');
    if (!dto.destinationId) throw new BadRequestException('Selecciona la sucursal destino.');

    const destination = await this.subsidiaryRepository.findOne({
      where: { id: dto.destinationId },
      select: ['id', 'name'],
    });
    if (!destination) throw new BadRequestException('La sucursal destino no existe.');

    // Resolver el paquete (por id si vino, si no por número de guía, el más reciente).
    let shipment: Shipment | null = null;
    let charge: ChargeShipment | null = null;

    if (dto.shipmentId) {
      shipment = await this.shipmentRepository.findOne({ where: { id: dto.shipmentId }, relations: ['subsidiary'] });
    } else if (dto.chargeShipmentId) {
      charge = await this.chargeShipmentRepository.findOne({ where: { id: dto.chargeShipmentId }, relations: ['subsidiary'] });
    } else {
      shipment = await this.shipmentRepository.findOne({
        where: { trackingNumber },
        relations: ['subsidiary'],
        order: { createdAt: 'DESC' },
      });
      if (!shipment) {
        charge = await this.chargeShipmentRepository.findOne({
          where: { trackingNumber },
          relations: ['subsidiary'],
          order: { createdAt: 'DESC' },
        });
      }
    }

    const entity = shipment || charge;
    if (!entity) throw new NotFoundException(`No se encontró el paquete ${trackingNumber}.`);

    const originId = entity.subsidiary?.id ?? null;
    if (originId && originId === destination.id) {
      throw new BadRequestException('El paquete ya pertenece a esa sucursal.');
    }

    const isCharge = !!charge;
    const note = `Traspaso por enrutamiento: ${entity.subsidiary?.name ?? 'N/D'} → ${destination.name}${dto.reason ? ` (${dto.reason})` : ''}`;

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Cambiar la sucursal (mantiene el estatus actual).
      if (isCharge) {
        await queryRunner.manager.update(ChargeShipment, { id: entity.id }, { subsidiary: { id: destination.id } as any });
        await queryRunner.manager.save(
          ShipmentStatus,
          queryRunner.manager.create(ShipmentStatus, {
            status: entity.status,
            notes: note,
            timestamp: new Date(),
            chargeShipment: { id: entity.id } as ChargeShipment,
          }),
        );
      } else {
        await queryRunner.manager.update(Shipment, { id: entity.id }, { subsidiary: { id: destination.id } as any });
        await queryRunner.manager.save(
          ShipmentStatus,
          queryRunner.manager.create(ShipmentStatus, {
            status: entity.status,
            notes: note,
            timestamp: new Date(),
            shipment: { id: entity.id } as Shipment,
          }),
        );
      }

      // 2. Registrar el traspaso.
      const record = queryRunner.manager.create(PackageTransfer, {
        trackingNumber,
        originId,
        destinationId: destination.id,
        shipmentId: isCharge ? null : entity.id,
        chargeShipmentId: isCharge ? entity.id : null,
        source: dto.source || null,
        reason: dto.reason || null,
        createdById: userId || null,
        date: new Date(),
      });
      await queryRunner.manager.save(PackageTransfer, record);

      await queryRunner.commitTransaction();

      return {
        success: true,
        trackingNumber,
        isCharge,
        originId,
        destinationId: destination.id,
        destinationName: destination.name,
        status: entity.status,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}

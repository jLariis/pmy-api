import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Subsidiary, Vehicle } from 'src/entities';
import { Not, Repository } from 'typeorm';
import { VehicleStatus } from 'src/common/enums/vehicle-status-enum';

@Injectable()
export class VehiclesService {
  constructor(
    @InjectRepository(Vehicle)
    private readonly vehicleRepository: Repository<Vehicle>,
    @InjectRepository(Subsidiary)
    private readonly subsidiaryRepository: Repository<Subsidiary>,
  ) {}

  async create(createVehicleDto: CreateVehicleDto, userId?: string) {
    if (!createVehicleDto.subsidiary?.id) {
      throw new BadRequestException('La sucursal es obligatoria.');
    }
    const subsidiaryObj = await this.subsidiaryRepository.findOneBy({ id: createVehicleDto.subsidiary.id });
    if (!subsidiaryObj) {
      throw new NotFoundException('Sucursal no encontrada.');
    }

    const newVehicle = this.vehicleRepository.create({
      ...createVehicleDto,
      subsidiary: { id: subsidiaryObj.id },
      createdById: userId ?? null,
    });

    return await this.vehicleRepository.save(newVehicle);
  }

  async findAll() {
    return await this.vehicleRepository.find({
      where: { status: Not(VehicleStatus.INACTIVE) },
      relations: ['subsidiary'],
      order: { name: 'ASC' },
    });
  }

  async findOne(id: string) {
    return await this.vehicleRepository.findOne({ where: { id }, relations: ['subsidiary'] });
  }

  async findBySubsidiary(subsidiaryId: string) {
    return await this.vehicleRepository.find({
      where: { subsidiary: { id: subsidiaryId }, status: Not(VehicleStatus.INACTIVE) },
      relations: ['subsidiary'],
      order: { name: 'ASC' },
    });
  }

  async update(id: string, updateVehicleDto: UpdateVehicleDto) {
    const vehicle = await this.vehicleRepository.findOne({ where: { id } });
    if (!vehicle) throw new NotFoundException('Vehículo no encontrado.');

    const { subsidiary, ...rest } = updateVehicleDto as any;
    this.vehicleRepository.merge(vehicle, rest);
    if (subsidiary?.id) vehicle.subsidiary = { id: subsidiary.id } as Subsidiary;

    return await this.vehicleRepository.save(vehicle);
  }

  /** Borrado lógico: marca INACTIVO (preserva trazabilidad con salidas a ruta, desembarques). */
  async remove(id: string) {
    const vehicle = await this.vehicleRepository.findOne({ where: { id } });
    if (!vehicle) throw new NotFoundException('Vehículo no encontrado.');
    vehicle.status = VehicleStatus.INACTIVE;
    return await this.vehicleRepository.save(vehicle);
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { Transfer } from 'src/entities';

@Injectable()
export class TransferService {
  constructor(
    @InjectRepository(Transfer)
    private readonly transferRepository: Repository<Transfer>,
  ) {}

  async create(createTransferDto: CreateTransferDto, userId: string): Promise<Transfer> {
    const transfer = this.transferRepository.create({
      ...createTransferDto,
      createdById: userId, // Asumiendo que obtienes el usuario del token JWT
    });

    // Si envían driverIds, podrías mapearlos aquí si es necesario
    // transfer.drivers = createTransferDto.driverIds.map(id => ({ id } as Driver));

    return await this.transferRepository.save(transfer);
  }

  async findAll(): Promise<Transfer[]> {
    return await this.transferRepository.find({
      relations: ['origin', 'destination', 'vehicle', 'drivers'],
      order: {
        createdAt: 'DESC',
      },
    });
  }

  async findOne(id: string): Promise<Transfer> {
    const transfer = await this.transferRepository.findOne({
      where: { id },
      relations: ['origin', 'destination', 'vehicle', 'drivers', 'createdBy'],
    });

    if (!transfer) {
      throw new NotFoundException(`Transfer with ID ${id} not found`);
    }

    return transfer;
  }
}
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { Income, Transfer } from 'src/entities';
import { IncomeSourceType, IncomeStatus, ShipmentType, TransferType } from 'src/common/enums';

@Injectable()
export class TransferService {
  constructor(
    @InjectRepository(Transfer)
    private readonly transferRepository: Repository<Transfer>,
    private readonly dataSource: DataSource
  ) {}

  async create(createTransferDto: CreateTransferDto, userId: string): Promise<Transfer> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Crear y guardar el traslado DENTRO de la transacción      
      console.log("🚀 ~ TransferService ~ create ~ createTransferDto:", createTransferDto)

      const transfer = queryRunner.manager.create(Transfer, {
        ...createTransferDto,
        createdById: userId,
      });
      const savedTransfer = await queryRunner.manager.save(transfer);

      // 2. Definir valores por defecto (Comportamiento para "OTHER" o "Especial")
      let finalAmount = createTransferDto.amount || 0; 
      let sourceType = IncomeSourceType.SPECIAL_TRANSFER; // Valor por defecto
      let incomeType = IncomeStatus.TRASLADO_ESPECIAL; // Valor por defecto

      // 3. Sobrescribir si es Tyco o Aeropuerto
      if (createTransferDto.transferType === TransferType.TYCO) {
        finalAmount = 2500;
        sourceType = IncomeSourceType.TYCO;
        incomeType = IncomeStatus.TYCO;
      } else if (createTransferDto.transferType === TransferType.AEROPUERTO) {
        finalAmount = 3500;
        sourceType = IncomeSourceType.AEROPUERTO;
        incomeType = IncomeStatus.AEROPUERTO;
      }

      // 4. Crear y guardar el ingreso DENTRO de la transacción
      const newIncome = queryRunner.manager.create(Income, {
        subsidiary: { id: createTransferDto.originId }, 
        shipmentType: ShipmentType.OTHER, 
        cost: finalAmount,
        incomeType: incomeType,
        isGrouped: false,
        sourceType: sourceType,
        date: new Date(), 
      });

      await queryRunner.manager.save(newIncome);

      // 5. Confirmar transacción si todo salió bien
      await queryRunner.commitTransaction();
      
      return savedTransfer;

    } catch (error) {
      // Si algo falla (ej. base de datos caída), deshacemos TODOS los cambios
      await queryRunner.rollbackTransaction();
      console.error("Error al crear el traslado:", error);
      throw error; // Relanzamos el error para que NestJS responda con un 500 o 400
    } finally {
      // SIEMPRE liberar la conexión, haya sido exitoso o fallido
      await queryRunner.release();
    }
  }

  async findAll(): Promise<Transfer[]> {
    return await this.transferRepository.find({
      relations: ['origin', 'destination', 'vehicle', 'drivers'],
      order: {
        createdAt: 'DESC',
      },
    });
  }

  async findBySubsidiary(subsidiaryId: string): Promise<Transfer[]> {
    return await this.transferRepository.find({
      where: { origin: { id: subsidiaryId } },
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
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { Income, Subsidiary, Transfer } from 'src/entities';
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
      console.log("🚀 ~ TransferService ~ create ~ createTransferDto:", createTransferDto);
      
      const subsidiary = await queryRunner.manager.findOne(Subsidiary, { where: { id: createTransferDto.originId } });

      // 1. Determine Base Amount and Types
      let baseAmount = Number(createTransferDto.amount) || 4689.45; 
      let sourceType = IncomeSourceType.SPECIAL_TRANSFER;
      let incomeType = IncomeStatus.TRASLADO_ESPECIAL;

      if (createTransferDto.transferType === TransferType.TYCO) {
        baseAmount = Number(subsidiary?.tycoAmount) || baseAmount;
        sourceType = IncomeSourceType.TYCO;
        incomeType = IncomeStatus.TYCO;
      } else if (createTransferDto.transferType === TransferType.AEROPUERTO) {
        baseAmount = Number(subsidiary?.airportAmount) || 4689.45; 
        sourceType = IncomeSourceType.AEROPUERTO;
        incomeType = IncomeStatus.AEROPUERTO;
      }

      // 2. Determine Extra Costs
      const extraAmount = Number(createTransferDto.extraAmount) || 0;
      let secondAboardAmount = 0;

      if (createTransferDto.secondAbord) {
        secondAboardAmount = Number(subsidiary?.secondAbordAmount) || 559.71;
        createTransferDto.secondAboardAmount = secondAboardAmount;
      }

      // 3. Explicit Mathematical Sum
      createTransferDto.totalAmount = baseAmount + extraAmount + secondAboardAmount;

      // 4. Save Transfer
      const transfer = queryRunner.manager.create(Transfer, {
        ...createTransferDto,
        createdById: userId,
      });

      const savedTransfer = await queryRunner.manager.save(transfer);
      
      // 5. Save Income
      const newIncome = queryRunner.manager.create(Income, {
        subsidiary: { id: createTransferDto.originId }, 
        shipmentType: ShipmentType.OTHER, 
        cost: createTransferDto.totalAmount, 
        incomeType: incomeType,
        isGrouped: false,
        sourceType: sourceType,
        date: createTransferDto.transferDate, // Usamos la fecha del traslado
        createdById: userId ?? null,
      });

      await queryRunner.manager.save(newIncome);

      await queryRunner.commitTransaction();
      
      return savedTransfer;

    } catch (error) {
      await queryRunner.rollbackTransaction();
      console.error("Error creating transfer:", error);
      throw error; 
    } finally {
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
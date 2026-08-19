import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Shipment } from 'src/entities';
import { ChargeShipment } from 'src/entities/charge-shipment.entity';
import { ForPickUp } from 'src/entities/for-pick-up.entity';
import { WarehouseDelivery } from 'src/entities/warehouse-delivery.entity';
import { PickUpService } from './pick-up.service';

// Repositorio TypeORM mockeado (solo lo que el servicio pudiera invocar).
const mockRepo = () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  findOneBy: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  createQueryBuilder: jest.fn(),
  manager: { getRepository: jest.fn() },
});

describe('PickUpService', () => {
  let service: PickUpService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PickUpService,
        { provide: getRepositoryToken(Shipment), useValue: mockRepo() },
        { provide: getRepositoryToken(ChargeShipment), useValue: mockRepo() },
        { provide: getRepositoryToken(ForPickUp), useValue: mockRepo() },
        { provide: getRepositoryToken(WarehouseDelivery), useValue: mockRepo() },
        { provide: DataSource, useValue: { createQueryRunner: jest.fn() } },
      ],
    }).compile();

    service = module.get<PickUpService>(PickUpService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

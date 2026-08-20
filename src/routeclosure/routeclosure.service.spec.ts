import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RouteClosure } from 'src/entities/route-closure.entity';
import { PackageDispatch } from 'src/entities/package-dispatch.entity';
import { MailService } from 'src/mail/mail.service';
import { FedexService } from 'src/shipments/fedex.service';
import { TemplateService } from 'src/documents/template.service';
import { TrackingCompareService } from 'src/tracking-sync/tracking-compare.service';
import { RouteclosureService } from './routeclosure.service';

// Repositorio TypeORM mockeado (solo lo que el servicio pudiera invocar).
const mockRepo = () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  findOneBy: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  createQueryBuilder: jest.fn(),
  manager: { getRepository: jest.fn() },
});

describe('RouteclosureService', () => {
  let service: RouteclosureService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RouteclosureService,
        { provide: getRepositoryToken(RouteClosure), useValue: mockRepo() },
        { provide: getRepositoryToken(PackageDispatch), useValue: mockRepo() },
        { provide: MailService, useValue: {} },
        { provide: FedexService, useValue: {} },
        { provide: DataSource, useValue: { createQueryRunner: jest.fn() } },
        { provide: TemplateService, useValue: { render: jest.fn() } },
        { provide: TrackingCompareService, useValue: { applyByRoute: jest.fn() } },
      ],
    }).compile();

    service = module.get<RouteclosureService>(RouteclosureService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

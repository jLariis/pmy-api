import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Expense, Income, Subsidiary } from 'src/entities';
import { TemplateService } from 'src/documents/template.service';
import { ResportsService } from './resports.service';

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

describe('ResportsService', () => {
  let service: ResportsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResportsService,
        { provide: getRepositoryToken(Expense), useValue: mockRepo() },
        { provide: getRepositoryToken(Income), useValue: mockRepo() },
        { provide: getRepositoryToken(Subsidiary), useValue: mockRepo() },
        { provide: TemplateService, useValue: { render: jest.fn() } },
      ],
    }).compile();

    service = module.get<ResportsService>(ResportsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

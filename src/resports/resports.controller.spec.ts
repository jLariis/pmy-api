import { Test, TestingModule } from '@nestjs/testing';
import { ResportsController } from './resports.controller';
import { ResportsService } from './resports.service';

describe('ResportsController', () => {
  let controller: ResportsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ResportsController],
      // Mockeamos el servicio inyectado (evita resolver los repos TypeORM del
      // ResportsService real). Suficiente para el smoke test `should be defined`.
      providers: [{ provide: ResportsService, useValue: {} }],
    }).compile();

    controller = module.get<ResportsController>(ResportsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});

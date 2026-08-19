import { Test, TestingModule } from '@nestjs/testing';
import { RouteclosureController } from './routeclosure.controller';
import { RouteclosureService } from './routeclosure.service';

describe('RouteclosureController', () => {
  let controller: RouteclosureController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RouteclosureController],
      // Mockeamos el servicio inyectado (evita resolver los repos TypeORM del
      // RouteclosureService real). Suficiente para el smoke test `should be defined`.
      providers: [{ provide: RouteclosureService, useValue: {} }],
    }).compile();

    controller = module.get<RouteclosureController>(RouteclosureController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});

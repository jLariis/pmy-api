import { Test, TestingModule } from '@nestjs/testing';
import { RouteclosureController } from './routeclosure.controller';
import { RouteclosureService } from './routeclosure.service';
import { ClosureDoctorService } from './closure-doctor.service';
import { RouteRiskReportService } from './risk-report/route-risk-report.service';

describe('RouteclosureController', () => {
  let controller: RouteclosureController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RouteclosureController],
      // Mockeamos el servicio inyectado (evita resolver los repos TypeORM del
      // RouteclosureService real). Suficiente para el smoke test `should be defined`.
      providers: [
        { provide: RouteclosureService, useValue: {} },
        { provide: ClosureDoctorService, useValue: {} },
        { provide: RouteRiskReportService, useValue: {} },
      ],
    }).compile();

    controller = module.get<RouteclosureController>(RouteclosureController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});

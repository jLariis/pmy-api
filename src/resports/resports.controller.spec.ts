import { Test, TestingModule } from '@nestjs/testing';
import { ResportsController } from './resports.controller';
import { ResportsService } from './resports.service';

describe('ResportsController', () => {
  let controller: ResportsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ResportsController],
      providers: [ResportsService],
    }).compile();

    controller = module.get<ResportsController>(ResportsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});

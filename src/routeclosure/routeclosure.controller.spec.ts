import { Test, TestingModule } from '@nestjs/testing';
import { RouteclosureController } from './routeclosure.controller';
import { RouteclosureService } from './routeclosure.service';

describe('RouteclosureController', () => {
  let controller: RouteclosureController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RouteclosureController],
      providers: [RouteclosureService],
    }).compile();

    controller = module.get<RouteclosureController>(RouteclosureController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});

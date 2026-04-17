import { Test, TestingModule } from '@nestjs/testing';
import { PickUpController } from './pick-up.controller';
import { PickUpService } from './pick-up.service';

describe('PickUpController', () => {
  let controller: PickUpController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PickUpController],
      providers: [PickUpService],
    }).compile();

    controller = module.get<PickUpController>(PickUpController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});

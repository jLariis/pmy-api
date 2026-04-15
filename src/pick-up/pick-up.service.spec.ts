import { Test, TestingModule } from '@nestjs/testing';
import { PickUpService } from './pick-up.service';

describe('PickUpService', () => {
  let service: PickUpService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PickUpService],
    }).compile();

    service = module.get<PickUpService>(PickUpService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

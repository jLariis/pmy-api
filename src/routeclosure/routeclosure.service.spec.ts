import { Test, TestingModule } from '@nestjs/testing';
import { RouteclosureService } from './routeclosure.service';

describe('RouteclosureService', () => {
  let service: RouteclosureService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RouteclosureService],
    }).compile();

    service = module.get<RouteclosureService>(RouteclosureService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { ResportsService } from './resports.service';

describe('ResportsService', () => {
  let service: ResportsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ResportsService],
    }).compile();

    service = module.get<ResportsService>(ResportsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

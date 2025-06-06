import { Controller, Get } from '@nestjs/common';
import { SubsidiariesService } from './subsidiaries.service';


@Controller()
export class SubsidiariesController {
  constructor(private readonly subsidiariesService: SubsidiariesService) {}

}

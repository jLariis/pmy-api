import { PartialType } from '@nestjs/swagger';
import { CreateConsolidatedDto } from './create-consolidated.dto';

export class UpdateConsolidatedDto extends PartialType(CreateConsolidatedDto) {}

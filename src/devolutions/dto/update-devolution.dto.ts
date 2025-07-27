import { PartialType } from '@nestjs/swagger';
import { CreateDevolutionDto } from './create-devolution.dto';

export class UpdateDevolutionDto extends PartialType(CreateDevolutionDto) {}

import { PartialType } from '@nestjs/swagger';
import { CreateResportDto } from './create-resport.dto';

export class UpdateResportDto extends PartialType(CreateResportDto) {}

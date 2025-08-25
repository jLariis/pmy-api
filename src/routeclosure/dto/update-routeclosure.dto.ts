import { PartialType } from '@nestjs/swagger';
import { CreateRouteclosureDto } from './create-routeclosure.dto';

export class UpdateRouteclosureDto extends PartialType(CreateRouteclosureDto) {}

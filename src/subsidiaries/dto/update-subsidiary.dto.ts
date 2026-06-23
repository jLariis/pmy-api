import { PartialType } from '@nestjs/swagger';
import { CreateSubsidiaryDto } from './create-subsidiary.dto';

export class UpdateSubsidiaryDto extends PartialType(CreateSubsidiaryDto) {}

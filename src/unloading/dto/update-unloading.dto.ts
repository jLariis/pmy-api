import { PartialType } from '@nestjs/swagger';
import { CreateUnloadingDto } from './create-unloading.dto';

export class UpdateUnloadingDto extends PartialType(CreateUnloadingDto) {}

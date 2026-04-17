import { PartialType } from '@nestjs/swagger';
import { CreatePickUpDto } from './create-pick-up.dto';

export class UpdatePickUpDto extends PartialType(CreatePickUpDto) {}

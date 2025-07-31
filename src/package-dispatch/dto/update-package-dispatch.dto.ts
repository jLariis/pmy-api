import { PartialType } from '@nestjs/swagger';
import { CreatePackageDispatchDto } from './create-package-dispatch.dto';

export class UpdatePackageDispatchDto extends PartialType(CreatePackageDispatchDto) {}

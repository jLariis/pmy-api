import { Body, Controller, ForbiddenException, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { PackageTransferService } from './package-transfer.service';
import { CreatePackageTransferDto } from './dto/create-package-transfer.dto';

// Roles permitidos para corregir el enrutamiento de un paquete.
const ALLOWED_ROLES = ['subadmin', 'admin', 'superadmin', 'superamin'];

@ApiTags('package-transfers')
@ApiBearerAuth()
@Controller('package-transfers')
@UseGuards(JwtAuthGuard)
export class PackageTransferController {
  constructor(private readonly packageTransferService: PackageTransferService) {}

  @Post()
  create(@Body() dto: CreatePackageTransferDto, @Req() req: any) {
    const role = req.user?.role;
    if (!ALLOWED_ROLES.includes(role)) {
      throw new ForbiddenException('No tienes permiso para realizar traspasos.');
    }
    return this.packageTransferService.create(dto, req.user?.userId);
  }
}

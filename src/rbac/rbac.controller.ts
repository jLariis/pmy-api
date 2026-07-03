import { Body, Controller, Delete, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SuperAdminGuard } from 'src/audit/super-admin.guard';
import { RbacService } from './rbac.service';
import {
  CreateRoleDto,
  SetRolePermissionsDto,
  SetUserPermissionsDto,
  SetUserSubsidiariesDto,
  UpdateRoleDto,
} from './dto/role.dto';

/**
 * Gestión de RBAC (roles, permisos y overrides por usuario). EXCLUSIVO superadmin
 * (igual que la página de Configuración). Más adelante puede migrar a
 * @RequirePermission('configuracion').
 */
@ApiTags('rbac')
@ApiBearerAuth()
@UseGuards(SuperAdminGuard)
@Controller('rbac')
export class RbacController {
  constructor(private readonly rbac: RbacService) {}

  @Get('permissions')
  getPermissions() {
    return this.rbac.getPermissions();
  }

  @Get('roles')
  getRoles() {
    return this.rbac.getRoles();
  }

  @Post('roles')
  createRole(@Body() dto: CreateRoleDto) {
    return this.rbac.createRole(dto);
  }

  @Patch('roles/:id')
  updateRole(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.rbac.updateRole(id, dto);
  }

  @Delete('roles/:id')
  deleteRole(@Param('id') id: string) {
    return this.rbac.deleteRole(id);
  }

  @Put('roles/:id/permissions')
  setRolePermissions(@Param('id') id: string, @Body() dto: SetRolePermissionsDto) {
    return this.rbac.setRolePermissions(id, dto);
  }

  @Get('users/:userId/permissions')
  getUserPermissions(@Param('userId') userId: string) {
    return this.rbac.getUserPermissions(userId);
  }

  @Put('users/:userId/permissions')
  setUserPermissions(@Param('userId') userId: string, @Body() dto: SetUserPermissionsDto) {
    return this.rbac.setUserPermissions(userId, dto);
  }

  @Get('users/:userId/subsidiaries')
  getUserSubsidiaries(@Param('userId') userId: string) {
    return this.rbac.getUserSubsidiaries(userId);
  }

  @Put('users/:userId/subsidiaries')
  setUserSubsidiaries(@Param('userId') userId: string, @Body() dto: SetUserSubsidiariesDto) {
    return this.rbac.setUserSubsidiaries(userId, dto);
  }
}

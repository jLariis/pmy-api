import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ApiBearerAuth, ApiBody, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from 'src/auth/guards/admin.guard';

/**
 * Gestión de usuarios — SOLO administradores. Antes `register` era `@Public()`
 * (cualquiera podía auto-registrarse con role:'superadmin') y las demás rutas no
 * tenían guard de rol (cualquier autenticado podía listar/editar/borrar usuarios
 * y cambiar roles). El `AdminGuard` a nivel de controller cierra ambos huecos.
 */
@ApiTags('users')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  getAll() {
    return this.usersService.findAll();
  }

  @ApiBody({ type: CreateUserDto })
  @Post('register')
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(id, updateUserDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }

  @Post('bcrypt-pass')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        pass: { type: 'string', example: 'MiContraseña123' },
      },
      required: ['pass'],
    },
  })
  async bcryptPass(@Body('pass') pass: string) {
    return this.usersService.bcryptPass(pass);
  }
}

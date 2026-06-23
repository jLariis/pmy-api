import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../entities/user.entity';
import { Role } from '../entities/role.entity';

@Module({
  controllers: [UsersController],
  imports: [TypeOrmModule.forFeature([User, Role])],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule { }

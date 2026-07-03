import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Permission, Role, Subsidiary, User, UserPermission } from 'src/entities';
import { RbacService } from './rbac.service';
import { RbacController } from './rbac.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Role, Permission, UserPermission, User, Subsidiary])],
  controllers: [RbacController],
  providers: [RbacService],
  exports: [RbacService],
})
export class RbacModule {}

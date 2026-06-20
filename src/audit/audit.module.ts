import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditLog } from 'src/entities/audit-log.entity';
import { User } from 'src/entities/user.entity';
import { Subsidiary } from 'src/entities/subsidiary.entity';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { AuditInterceptor } from './audit.interceptor';

/**
 * @Global: AuditService queda disponible en cualquier módulo sin re-importar,
 * para registrar eventos de dominio (login/logout, before/after) donde haga falta.
 * El acceso al controlador se restringe con SuperAdminGuard (lee req.user, sin DI extra).
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AuditLog, User, Subsidiary])],
  controllers: [AuditController],
  providers: [
    AuditService,
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
  exports: [AuditService],
})
export class AuditModule {}

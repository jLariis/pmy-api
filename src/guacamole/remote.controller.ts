import { BadRequestException, Body, Controller, Post, UseGuards } from '@nestjs/common';
import { SuperAdminGuard } from 'src/audit/super-admin.guard';
import { encryptConnectionToken } from './connection-token.util';
import type { GuacProtocol } from './guacd-client';

interface StartRemoteDto {
  protocol: GuacProtocol;
}

/**
 * Acuña el token de conexión (cifrado) para acceder AL SERVIDOR. Las credenciales
 * viven aquí (env/secretos), NUNCA en el navegador. EXCLUSIVO superadmin
 * (JwtAuthGuard es global; añadimos SuperAdminGuard). No hay permiso RBAC
 * grantable a propósito: nadie más que superadmin puede usarlo.
 */
@UseGuards(SuperAdminGuard)
@Controller('remote')
export class RemoteController {
  @Post('session')
  start(@Body() dto: StartRemoteDto) {
    const protocol = dto?.protocol;
    if (protocol !== 'vnc' && protocol !== 'ssh') {
      throw new BadRequestException('Protocolo no permitido (solo vnc | ssh).');
    }

    // guacd corre en el MISMO servidor → el destino es localhost.
    const host = process.env.REMOTE_HOST ?? '127.0.0.1';

    const settings =
      protocol === 'ssh'
        ? {
            hostname: host,
            port: process.env.REMOTE_SSH_PORT ?? '22',
            username: process.env.REMOTE_SSH_USER ?? '',
            password: process.env.REMOTE_SSH_PASSWORD ?? '',
          }
        : {
            // VNC al Xorg físico (x11vnc en :0 → 5901), solo localhost.
            hostname: host,
            port: process.env.REMOTE_VNC_PORT ?? '5901',
            password: process.env.REMOTE_VNC_PASSWORD ?? '',
          };

    return { connection: encryptConnectionToken({ protocol, settings }) };
  }
}

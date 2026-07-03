import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { jwtConstants } from 'src/auth/constants';
import { GuacamoleGateway } from './guacamole.gateway';
import { RemoteController } from './remote.controller';

/**
 * Acceso Remoto Gráfico (VNC) + Terminal SSH al servidor vía Apache Guacamole.
 * EXCLUSIVO superadmin. El gateway abre un túnel WS crudo hacia guacd (local).
 */
@Module({
  imports: [JwtModule.register({ secret: jwtConstants.secret })],
  controllers: [RemoteController],
  providers: [GuacamoleGateway],
})
export class GuacamoleModule {}

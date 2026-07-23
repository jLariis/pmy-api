import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { jwtConstants } from '../constants';
import { BlacklistService } from '../blacklist.service';
import { SessionContextService } from '../session-context.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    constructor(
        private readonly blacklistService: BlacklistService,
        private readonly sessionContext: SessionContextService,
    ) {
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey: jwtConstants.secret,
        });
    }

    /**
     * El JWT solo trae { sub, email, role }. El estado "pesado" (permisos,
     * sucursales) YA NO viaja en el token —era la causa del HTTP 431—; se resuelve
     * aquí desde la BD (con caché corta en SessionContextService) y se inyecta en
     * `req.user` con LAS MISMAS CLAVES de antes, para que los guards
     * (PermissionsGuard, SubsidiaryScopeGuard, IncomeAccessGuard) sigan
     * funcionando sin cambios.
     */
    async validate(payload: any) {
        if (this.blacklistService.has(payload.sub)) {
            throw new UnauthorizedException('Token is invalid');
        }

        const session = await this.sessionContext.getEnrichedSession(payload.sub);
        if (!session) {
            // Usuario borrado/inactivo tras emitir el token → sesión inválida.
            throw new UnauthorizedException('Sesión inválida');
        }

        return {
            userId: payload.sub,
            email: payload.email,
            // El rol autoritativo viene de la BD (por si cambió desde el login);
            // se cae al del token como respaldo.
            role: session.role ?? payload.role,
            name: session.name,
            lastName: session.lastName,
            subsidiary: session.subsidiary,
            additionalSubsidiaries: session.additionalSubsidiaries,
            subsidiaryIds: session.subsidiaryIds,
            permissions: session.permissions,
        };
    }
}

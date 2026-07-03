import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { jwtConstants } from '../constants';
import { BlacklistService } from '../blacklist.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    constructor(private readonly blacklistService: BlacklistService) {
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey: jwtConstants.secret,
        });
    }

    async validate(payload: any) {
        if(this.blacklistService.has(payload.sub)){
            throw new UnauthorizedException('Token is invalid');
        }
        // Exponemos también nombre y sucursal (vienen en el token) para auditoría
        // y notificaciones seccionadas por sucursal.
        return {
            userId: payload.sub,
            email: payload.email,
            role: payload.role,
            name: payload.name,
            lastName: payload.lastName,
            subsidiary: payload.subsidiary,
            additionalSubsidiaries: Array.isArray(payload.additionalSubsidiaries) ? payload.additionalSubsidiaries : [],
            subsidiaryIds: Array.isArray(payload.subsidiaryIds) ? payload.subsidiaryIds : [],
            permissions: Array.isArray(payload.permissions) ? payload.permissions : [],
        };
    }
}
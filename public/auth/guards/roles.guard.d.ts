import { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtTokenService } from '../jwt-token.service';
export declare class RolesGuard implements CanActivate {
    private readonly reflector;
    private readonly jwtTokenService;
    constructor(reflector: Reflector, jwtTokenService: JwtTokenService);
    canActivate(context: ExecutionContext): boolean;
    private extractTokenFromHeader;
}

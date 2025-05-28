import { JwtService } from '@nestjs/jwt';
export declare class JwtTokenService {
    private readonly jwtService;
    constructor(jwtService: JwtService);
    generateToken(payload: any): string;
    verifyToken(token: string): any;
}

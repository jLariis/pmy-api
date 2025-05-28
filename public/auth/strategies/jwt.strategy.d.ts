import { Strategy } from 'passport-jwt';
import { BlacklistService } from '../blacklist.service';
declare const JwtStrategy_base: new (...args: any[]) => Strategy;
export declare class JwtStrategy extends JwtStrategy_base {
    private readonly blacklistService;
    constructor(blacklistService: BlacklistService);
    validate(payload: any): Promise<{
        userId: any;
        email: any;
        role: any;
    }>;
}
export {};

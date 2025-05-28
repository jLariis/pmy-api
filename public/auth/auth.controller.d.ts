import { LoggerService } from '@nestjs/common';
import { AuthService } from './auth.service';
export declare class AuthController {
    private authService;
    private readonly logger;
    constructor(authService: AuthService, logger: LoggerService);
    login(req: any): Promise<{
        access_token: string;
        role: any;
        name: any;
    }>;
    logout(req: any): Promise<string>;
    recoverPassword(): Promise<{
        message: string;
    }>;
    resetPassword(body: {
        token: string;
        newPassword: string;
    }): Promise<void>;
}

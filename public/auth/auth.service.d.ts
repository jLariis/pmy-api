import { LoggerService } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { Repository } from "typeorm";
import { User } from 'src/users/dto/user.entity';
import { BlacklistService } from './blacklist.service';
import { EmailService } from './email.service';
export declare class AuthService {
    private usersService;
    private jwtService;
    private userRepository;
    private readonly logger;
    private blacklistService;
    private mailService;
    constructor(usersService: UsersService, jwtService: JwtService, userRepository: Repository<User>, logger: LoggerService, blacklistService: BlacklistService, mailService: EmailService);
    validateUser(email: string, password: string): Promise<any>;
    login(user: any): Promise<{
        access_token: string;
        role: any;
        name: any;
    }>;
    logout(token: string): Promise<string>;
    requestPasswordReset(dto: any): Promise<void>;
    resetPassword(token: string, newPassword: string): Promise<void>;
    validatePasswordComplexity(password: string): boolean;
}

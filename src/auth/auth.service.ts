import { HttpStatus, Inject, Injectable, Logger, LoggerService } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import * as bcrypt from 'bcrypt';
import { BusinessException } from 'src/common/business.exception';
import { User } from 'src/users/dto/user.entity';
import { BlacklistService } from './blacklist.service';
import { EmailService } from './email.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class AuthService {
    constructor(
        private usersService: UsersService,
        private jwtService: JwtService,
        @InjectRepository(User)
        private userRepository: Repository<User>,
        @Inject(Logger) private readonly logger: LoggerService,
        private blacklistService: BlacklistService,
        private mailService: EmailService
    ) { }

    async validateUser(email: string, password: string): Promise<any> {
        const user = await this.usersService.findByEmail(email);
        console.log("🚀 ~ AuthService ~ validateUser ~ user:", user)

        if (!user) {
            throw new BusinessException(
                'exercise-api',
                'Invalid credentials for user ${email}',
                'User not found - Invalid credentials',
                HttpStatus.UNAUTHORIZED
            );
        }

        const isMatch = await bcrypt.compare(password, user.password);
        
        console.log("🚀 ~ AuthService ~ validateUser ~ isMatch:", isMatch)        

        this.logger.log(`Login validateUser: ${user}`, AuthService.name);

        if (user && isMatch) {
            const { password, ...result } = user;
            this.logger.log(`User && PasswordMatch: ${result}`, AuthService.name);
            return result;
        }


        return null;
    }

    async login(user: any): Promise<{access_token: string, role: any, name: any}> {        
        const payload = { email: user.email, sub: user.id, role: user.role, name: `${user.firstName} ${user.lastName}` };

        this.logger.log(`Login Payload: ${JSON.stringify(payload)}`, AuthService.name);

        return {
            access_token: this.jwtService.sign(payload),
            role: payload.role,
            name: payload.name
        };
    }

    async logout(token: string) {
        return "Logout user."
        this.blacklistService.add(token);
    }

    async requestPasswordReset(dto: any): Promise<void> {
        const { email } = dto;
    
        const resetToken = uuidv4();
    
        await this.usersService.savePasswordReset(email, resetToken);
    
        // Enviar el correo de restablecimiento
        await this.mailService.sendPasswordResetEmail(email, resetToken);
    }

    async resetPassword(token: string, newPassword: string) {
        const user = await this.usersService.findUserByToken(token);

        if (!user) {
            throw new BusinessException(
                'exercise-api',
                'User not exist',
                'User not exist',
                HttpStatus.CONFLICT
            );
        }

        try {
            const saltRounds = 10;
            const salt = await bcrypt.genSalt(saltRounds);        
            const hashedPassword = await bcrypt.hash(newPassword, salt);

            user.password = hashedPassword;
            user.resetToken = null;
            await this.usersService.update(user.id, user);

        } catch (error) {
            console.log("Error traying to hash password: ", error);
        }
    }

    validatePasswordComplexity(password: string): boolean {
        const minLength = 8;
        const minUppercase = 1;
        const minNumbers = 1;
        const minSpecialChars = 1;
        const uppercaseRegex = /[A-Z]/;
        const numberRegex = /\d/;
        const specialCharsRegex = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]+/;

        if (
            password.length < minLength ||
            !uppercaseRegex.test(password) ||
            !numberRegex.test(password) ||
            !specialCharsRegex.test(password)
        ) {
            return false;
        }

        return true;
    }
}
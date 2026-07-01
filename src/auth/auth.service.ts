import { HttpStatus, Inject, Injectable, Logger, LoggerService } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import * as bcrypt from 'bcrypt';
import { BusinessException } from 'src/common/business.exception';
import { BlacklistService } from './blacklist.service';
import { EmailService } from './email.service';
import { v4 as uuidv4 } from 'uuid';
import { User } from 'src/entities/user.entity';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditModule, AuditResult, AuditSeverity } from '../common/enums/audit.enum';
import { RbacService } from '../rbac/rbac.service';

@Injectable()
export class AuthService {
    constructor(
        private usersService: UsersService,
        private jwtService: JwtService,
        @InjectRepository(User)
        private userRepository: Repository<User>,
        @Inject(Logger) private readonly logger: LoggerService,
        private blacklistService: BlacklistService,
        private mailService: EmailService,
        private readonly auditService: AuditService,
        private readonly rbacService: RbacService,
    ) { }

    async validateUser(email: string, password: string): Promise<any> {
        const user = await this.usersService.findByEmail(email);
        console.log("🚀 ~ AuthService ~ validateUser ~ user:", user)

        if (!user) {
            this.auditService.log({
                module: AuditModule.AUTH,
                action: AuditAction.LOGIN_FAILED,
                result: AuditResult.ERROR,
                severity: AuditSeverity.WARNING,
                userEmail: email,
                description: 'Intento de inicio de sesión: usuario no encontrado',
            });
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

        this.auditService.log({
            module: AuditModule.AUTH,
            action: AuditAction.LOGIN_FAILED,
            result: AuditResult.ERROR,
            severity: AuditSeverity.WARNING,
            userId: user.id,
            userEmail: email,
            role: user.role,
            description: 'Intento de inicio de sesión: contraseña incorrecta',
        });

        return null;
    }

    async login(user: any): Promise<{access_token: string, user: any}> {
        // Permisos efectivos (rol ∪ allow − deny). Si RBAC aún no está sembrado
        // o falla, el login NO se rompe: se entrega [] y el gateo cae al mapa de
        // roles legacy (transición de la Fase C).
        let permissions: string[] = [];
        try {
            permissions = await this.rbacService.getEffectivePermissions(user.id);
        } catch (err) {
            this.logger.warn(
                `No se pudieron calcular permisos efectivos para ${user.email}: ${err?.message}`,
                AuthService.name,
            );
        }

        const payload = {
            email: user.email,
            sub: user.id,
            role: user.role,
            name: user.name,
            lastName: user.lastName,
            subsidiary: user.subsidiary,
            permissions,
        };

        this.logger.log(`Login Payload: ${JSON.stringify(payload)}`, AuthService.name);

        // Marca el último inicio de sesión (auditoría/sesiones). No rompe el login si falla.
        this.userRepository.update(user.id, { lastLoginAt: new Date() }).catch(() => undefined);

        return {
            access_token: this.jwtService.sign(payload),
            user: {
                id: payload.sub,
                email: payload.email,
                role: payload.role,
                name: payload.name,
                lastName: payload.lastName,
                subsidiary: user.subsidiary,
                permissions,
            }

        };
    }

    async logout(token: string) {
        // Antes había un `return` ANTES del add → el token nunca se invalidaba.
        this.blacklistService.add(token);
        return "Logout user.";
    }

    // ===================== Recuperación de contraseña por OTP =====================

    private maskEmail(email: string): string {
        const [u, d] = (email || '').split('@');
        if (!d) return email;
        const head = u.length <= 2 ? (u[0] ?? '') : u.slice(0, 2);
        return `${head}${'*'.repeat(Math.max(1, u.length - head.length))}@${d}`;
    }

    /** Genera y envía un OTP al correo registrado. Si el correo no existe, error. */
    async requestPasswordOtp(email: string): Promise<{ message: string; email: string }> {
        const user = await this.usersService.findByEmail((email || '').trim().toLowerCase());
        if (!user) {
            throw new BusinessException('exercise-api', 'User not found for OTP', 'No existe una cuenta con ese correo.', HttpStatus.NOT_FOUND);
        }
        const code = Math.floor(100000 + Math.random() * 900000).toString(); // 6 dígitos
        const otpHash = await bcrypt.hash(code, 10);
        await this.userRepository.update(user.id, { otpCode: otpHash, otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000) });
        try {
            await this.mailService.sendOtpEmail(user.email, code, 10);
        } catch (err: any) {
            this.logger.error(`No se pudo enviar OTP a ${user.email}: ${err?.message}`, AuthService.name);
            throw new BusinessException('exercise-api', 'OTP email failed', 'No se pudo enviar el código. Intenta más tarde.', HttpStatus.INTERNAL_SERVER_ERROR);
        }
        return { message: 'Código enviado al correo registrado.', email: this.maskEmail(user.email) };
    }

    /** Verifica el OTP y restablece la contraseña. */
    async resetPasswordWithOtp(email: string, otp: string, newPassword: string): Promise<{ message: string }> {
        const user = await this.usersService.findByEmail((email || '').trim().toLowerCase());
        if (!user || !user.otpCode || !user.otpExpiresAt) {
            throw new BusinessException('exercise-api', 'No OTP pending', 'Solicita un nuevo código.', HttpStatus.BAD_REQUEST);
        }
        if (new Date(user.otpExpiresAt).getTime() < Date.now()) {
            throw new BusinessException('exercise-api', 'OTP expired', 'El código expiró. Solicita uno nuevo.', HttpStatus.BAD_REQUEST);
        }
        const ok = await bcrypt.compare(String(otp || '').trim(), user.otpCode);
        if (!ok) {
            throw new BusinessException('exercise-api', 'OTP mismatch', 'Código incorrecto.', HttpStatus.BAD_REQUEST);
        }
        if (!this.validatePasswordComplexity(newPassword)) {
            throw new BusinessException('exercise-api', 'Weak password', 'La contraseña debe tener mínimo 8 caracteres, una mayúscula, un número y un símbolo.', HttpStatus.BAD_REQUEST);
        }
        const hashed = await bcrypt.hash(newPassword, 10);
        await this.userRepository.update(user.id, { password: hashed, otpCode: null, otpExpiresAt: null });
        return { message: 'Contraseña actualizada. Ya puedes iniciar sesión.' };
    }

    /*async requestPasswordReset(dto: any): Promise<void> {
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
    }*/

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
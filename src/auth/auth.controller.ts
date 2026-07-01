import { Body, Controller, Inject, Logger, Post, Request, UseGuards, LoggerService  } from '@nestjs/common';
import { AuthService } from './auth.service';
import { ApiBasicAuth, ApiBearerAuth, ApiBody, ApiResponse, ApiTags } from '@nestjs/swagger';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { Public } from './decorators/decorators/public-decorator';
import { AppController } from "../app.controller";
import { AuthDto } from './dto/AuthDto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { Audit } from '../audit/audit.decorator';
import { AuditAction, AuditModule } from '../common/enums/audit.enum';

@ApiTags('auth')
@Controller('auth')
@Public()
export class AuthController {
    constructor(
        private authService: AuthService,
        @Inject(Logger) private readonly logger: LoggerService
    ) { }

    @UseGuards(LocalAuthGuard)
    @ApiBasicAuth()
    @ApiResponse({ status: 200, description: 'Correct credentials' })
    @ApiResponse({ status: 401, description: 'Invalid Credentials' })
    @ApiBody({ type: AuthDto})
    @Audit({ module: AuditModule.AUTH, action: AuditAction.LOGIN, resolveEntityId: ({ response }) => response?.user?.id })
    @Post('token')
    async login(@Request() req) {
        console.log("BODY:", req.body);
        this.logger.log('Calling login()', AppController.name);
        return this.authService.login(req.user);
    }

    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard)
    @Audit({ module: AuditModule.AUTH, action: AuditAction.LOGOUT })
    @Post('logout')
    async logout(@Request() req){
        this.logger.log('Calling logout()', AppController.name);
        const token = req.headers.authorization?.split(' ')[1];

        if(token) {
            return await this.authService.logout(token);
        }
    }

    // ---- Recuperación de contraseña por OTP (autoservicio, públicos) ----

    @Public()
    @Post('forgot-password')
    @ApiResponse({ status: 200, description: 'OTP enviado al correo registrado.' })
    @ApiResponse({ status: 404, description: 'No existe una cuenta con ese correo.' })
    async forgotPassword(@Body() body: { email: string }) {
        return this.authService.requestPasswordOtp(body?.email);
    }

    @Public()
    @Post('reset-password-otp')
    @ApiResponse({ status: 200, description: 'Contraseña actualizada.' })
    @ApiResponse({ status: 400, description: 'Código inválido/expirado o contraseña débil.' })
    async resetPasswordOtp(@Body() body: { email: string; otp: string; newPassword: string }) {
        return this.authService.resetPasswordWithOtp(body?.email, body?.otp, body?.newPassword);
    }

}

import { Body, Controller, Inject, Logger, Post, Request, UseGuards, LoggerService  } from '@nestjs/common';
import { AuthService } from './auth.service';
import { ApiBasicAuth, ApiBearerAuth, ApiBody, ApiHeader, ApiResponse, ApiTags } from '@nestjs/swagger';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { ChangePasswordDto } from "./dto/change-password.dto";
import { Public } from './decorators/decorators/public-decorator';
import { AppController } from "../app.controller";
import { AuthDto } from './dto/AuthDto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
    constructor(
        private authService: AuthService,
        @Inject(Logger) private readonly logger: LoggerService
    ) { }

    
    @Public()
    @UseGuards(LocalAuthGuard)
    @ApiBasicAuth()
    @ApiResponse({ status: 200, description: 'Correct credentials' })
    @ApiResponse({ status: 401, description: 'Invalid Credentials' })
    @ApiBody({ type: AuthDto})
    @Post('token')
    async login(@Request() req) {
        this.logger.log('Calling login()', AppController.name);
        return this.authService.login(req.user);
    }

    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard)
    @Post('logout')
    async logout(@Request() req){
        this.logger.log('Calling logout()', AppController.name);
        const token = req.headers.authorization?.split(' ')[1];

        if(token) {
            return await this.authService.logout(token);
        }
    }

    @Public()
    @Post('recover')
    async recoverPassword() {
        this.logger.log('Calling recoverPassword()', AppController.name);
        ///await this.authService.requestPasswordReset(dto);
        return { message: 'Reset password email sent.' };
    };

    @Post('reset-password')
    @Public()
    @ApiResponse({ status: 200, description: 'Password successfully updated.' })
    @ApiResponse({ status: 400, description: 'Invalid token or failed to update password.' })
    async resetPassword(
      @Body() body: { token: string; newPassword: string },
    ): Promise<void> {
      const { token, newPassword } = body;
        await this.authService.resetPassword(token, newPassword);
    }

}

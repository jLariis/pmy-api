import { Strategy } from 'passport-local';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';
import { AuthService } from '.././auth.service';
import { HttpStatus } from '@nestjs/common/enums';
import { BusinessException } from 'src/common/business.exception';


@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
    constructor(
        private authService: AuthService
    ) {
        super({
            usernameField: 'email',
            passwordField: 'password',
        });
    }

    async validate(email: string, password: string): Promise<any> {
        const user = await this.authService.validateUser(email, password);

        if (!user) {
            throw new BusinessException(
                'exercise-api',
                `Invalid credentials for user ${email}`,
                'User not found - Invalid credentials',
                HttpStatus.UNAUTHORIZED
            );
        }

        return user;
    }
}
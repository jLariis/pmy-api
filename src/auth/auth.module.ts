import { Module, Logger } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LocalStrategy } from './strategies/local.strategy';
import { UsersModule } from '../users/users.module';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { jwtConstants } from './constants';
import { JwtStrategy } from './strategies/jwt.strategy';
import { TypeOrmModule } from "@nestjs/typeorm";
import { JwtTokenService } from "./jwt-token.service";
import { User } from 'src/users/dto/user.entity';
import { AuthController } from './auth.controller';
import { BlacklistService } from './blacklist.service';
import { EmailService } from './email.service';

@Module({
    controllers: [AuthController],
    imports: [
        UsersModule,
        PassportModule,
        JwtModule.register({
            secret: jwtConstants.secret,
            signOptions: { expiresIn: jwtConstants.expiration },
        }),
        TypeOrmModule.forFeature([User])
    ],
    providers: [
        AuthService,
        LocalStrategy,
        JwtStrategy,
        JwtTokenService,
        Logger,
        BlacklistService,
        EmailService
    ],
    exports: [AuthService, JwtTokenService],
})
export class AuthModule { }
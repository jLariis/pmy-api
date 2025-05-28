import { JwtModule, JwtService } from '@nestjs/jwt'
import { Test, TestingModule } from '@nestjs/testing'
import { getRepositoryToken } from '@nestjs/typeorm'
import { User } from '../users/dto/user.entity'
import { UsersService } from '../users/users.service'
import { Repository } from 'typeorm'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { LocalStrategy } from './strategies/local.strategy'
import { BusinessException } from '../common/business.exception'
import spyOn = jest.spyOn;

describe('AuthController', () => {
    let controller: AuthController;
    let authService: AuthService;
    let usersService: UsersService;
    let localStrategy: LocalStrategy;
    const access_token = "sdfsdkfsdfw3ll3wl";

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            imports: [JwtModule.register({
                secret: 'secretKey',
                signOptions: {
                    expiresIn: '1h',
                },
            })],
            providers: [
                AuthService,
                LocalStrategy,
                JwtService,
                UsersService,
                {
                    provide: getRepositoryToken(User),
                    useClass: Repository,
                },
            ],
            controllers: [AuthController],
        }).compile()

        controller = module.get<AuthController>(AuthController);
        authService = module.get<AuthService>(AuthService);
        usersService = module.get<UsersService>(UsersService);
        localStrategy = module.get<LocalStrategy>(LocalStrategy);
    })

    it('should be defined', () => {
        expect(controller).toBeDefined();
    })

    it('should be able to login', async () => {



        const userMock = {
            username: 'maria',
            password: 'guess',
        };

        authService.login = jest.fn().mockReturnValue({ access_token: access_token })
        usersService.findOne = jest.fn().mockReturnValue({
            userId: 2,
            username: 'maria',
            password: 'guess',
        });

        spyOn(authService, 'login');
        spyOn(usersService, 'findOne');

        let userFound = usersService.findOne(userMock.username);
        let accessToken = authService.login(userFound);

        expect(accessToken).toEqual({ access_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6ImpvaG4iLCJpYXQiOjE2NzUyNjcxMTYsImV4cCI6MTY3NTI2NzE3Nn0.lpnkVVyD_luyP7mXdVtNSSWOXP5K6IzDgvI2nSAmG2E" })
    })

    it('should validate if the user is valid', async () => {

        const user = {
            username: 'maria',
            password: 'guess',
        };

        let userIsValid = await localStrategy.validate(user.username, user.password);

        expect(userIsValid).toStrictEqual({ 'userId': 2, 'username': 'maria' });
    })

    it('should validate if the user is not valid and throw business exception', async () => {

        await expect(async () => {
                await localStrategy.validate('', '');
            },
        ).rejects.toThrowError(BusinessException);
    })
})



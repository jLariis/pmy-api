import { JwtModule, JwtService } from '@nestjs/jwt'
import { Test, TestingModule } from '@nestjs/testing'
import { getRepositoryToken } from '@nestjs/typeorm'
import { User } from '../users/dto/user.entity'
import { UsersService } from '../users/users.service'
import { Repository } from 'typeorm'
import { AuthService } from './auth.service'
import spyOn = jest.spyOn

describe('AuthService', () => {
    let authService: AuthService
    let usersService: UsersService
    const access_token = 'fsdfsdfñl3lññl4ñlñwrñle'

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            imports: [JwtModule],
            providers: [
                AuthService,
                UsersService,
                JwtService,
                {
                    provide: getRepositoryToken(User),
                    useClass: Repository,
                },
            ],
        }).compile()

        authService = module.get<AuthService>(AuthService)
        usersService = module.get<UsersService>(UsersService)

        authService.login = jest.fn().mockReturnValue({ access_token: access_token })
        usersService.findOne = jest.fn().mockReturnValue({
            userId: 2,
            username: 'maria',
            password: 'guess',
        })

        spyOn(authService, 'login')
        spyOn(usersService, 'findOne')
    })

    it('should be defined', () => {
        expect(authService).toBeDefined()
    })

    it('method validateUser should validate the user', async () => {
        const user = {
            username: 'maria',
            password: 'guess',
        }

        const isUserValid = await authService.validateUser(user.username, user.password)

        expect(isUserValid).toStrictEqual({
            userId: 2,
            username: 'maria',
        });
    })

    it('method validateUser should not validate the user', async () => {
        const userIsNotValid = await authService.validateUser('', '');
        expect(userIsNotValid).toStrictEqual(null)
    });


    it('should allow the user login', () => {
        const username = "maria";

        let userFound = usersService.findOne(username);
        let accessToken = authService.login(userFound);

        expect(accessToken).toEqual({ access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6ImpvaG4iLCJpYXQiOjE2NzUyNjcxMTYsImV4cCI6MTY3NTI2NzE3Nn0.lpnkVVyD_luyP7mXdVtNSSWOXP5K6IzDgvI2nSAmG2E' });
    })
})

import { Logger } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { LocalStrategy } from './strategies/local.strategy'
import { BusinessException } from '../common/business.exception'

// Los tests originales fallaban por DI sin proveer (AuthService arrastra ~9
// dependencias) y validaban comportamiento obsoleto (JWT hardcodeado,
// usersService.findOne). Se reescriben mockeando AuthService directamente y
// ejercitando el LocalStrategy real contra ese mock (comportamiento actual).
describe('AuthController', () => {
  let controller: AuthController
  let authService: { login: jest.Mock; validateUser: jest.Mock }
  let localStrategy: LocalStrategy

  beforeEach(async () => {
    authService = { login: jest.fn(), validateUser: jest.fn() }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: Logger, useValue: { log: jest.fn(), error: jest.fn() } },
        LocalStrategy,
      ],
      controllers: [AuthController],
    }).compile()

    controller = module.get<AuthController>(AuthController)
    localStrategy = module.get<LocalStrategy>(LocalStrategy)
  })

  it('should be defined', () => {
    expect(controller).toBeDefined()
  })

  it('login delega en authService.login con req.user', async () => {
    const session = { access_token: 'signed.jwt.token', user: { id: '2', email: 'maria@x.com' } }
    authService.login.mockResolvedValue(session)

    const result = await controller.login({ user: { id: '2' }, body: {} } as any)

    expect(authService.login).toHaveBeenCalledWith({ id: '2' })
    expect(result).toBe(session)
  })

  it('LocalStrategy.validate devuelve el usuario cuando es válido', async () => {
    const user = { id: '2', email: 'maria@x.com' }
    authService.validateUser.mockResolvedValue(user)

    await expect(localStrategy.validate('maria@x.com', 'guess')).resolves.toBe(user)
  })

  it('LocalStrategy.validate lanza BusinessException cuando el usuario no es válido', async () => {
    authService.validateUser.mockResolvedValue(null)

    await expect(localStrategy.validate('', '')).rejects.toThrow(BusinessException)
  })
})

import { Logger } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Test, TestingModule } from '@nestjs/testing'
import { getRepositoryToken } from '@nestjs/typeorm'
import * as bcrypt from 'bcrypt'
import { User } from 'src/entities'
import { BusinessException } from '../common/business.exception'
import { UsersService } from '../users/users.service'
import { AuditService } from '../audit/audit.service'
import { RbacService } from '../rbac/rbac.service'
import { AuthService } from './auth.service'
import { BlacklistService } from './blacklist.service'
import { EmailService } from './email.service'
import { SessionContextService } from './session-context.service'

// Los tests originales validaban comportamiento ya inexistente (usersService.findOne,
// un JWT hardcodeado, validateUser devolviendo null cuando no hay usuario). Se
// reescriben contra el comportamiento actual del AuthService, proveyendo todas las
// dependencias inyectadas como mocks (antes faltaban y rompían el DI).
describe('AuthService', () => {
  let authService: AuthService
  let usersService: { findByEmail: jest.Mock; findOne: jest.Mock }
  let userRepository: { update: jest.Mock; findOne: jest.Mock }
  let jwtService: { sign: jest.Mock }
  let auditService: { log: jest.Mock }
  let sessionContext: { invalidate: jest.Mock; getEnrichedSession: jest.Mock }

  beforeEach(async () => {
    usersService = { findByEmail: jest.fn(), findOne: jest.fn() }
    userRepository = { update: jest.fn().mockResolvedValue(undefined), findOne: jest.fn() }
    jwtService = { sign: jest.fn().mockReturnValue('signed.jwt.token') }
    auditService = { log: jest.fn() }
    sessionContext = {
      invalidate: jest.fn(),
      getEnrichedSession: jest.fn().mockResolvedValue({ subsidiaryIds: ['s1'], permissions: ['p1'] }),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: jwtService },
        { provide: getRepositoryToken(User), useValue: userRepository },
        { provide: Logger, useValue: { log: jest.fn(), error: jest.fn(), warn: jest.fn() } },
        { provide: BlacklistService, useValue: { add: jest.fn() } },
        { provide: EmailService, useValue: { sendOtpEmail: jest.fn() } },
        { provide: AuditService, useValue: auditService },
        { provide: RbacService, useValue: {} },
        { provide: SessionContextService, useValue: sessionContext },
      ],
    }).compile()

    authService = module.get<AuthService>(AuthService)
  })

  it('should be defined', () => {
    expect(authService).toBeDefined()
  })

  it('validateUser devuelve el usuario sin password cuando las credenciales son válidas', async () => {
    const hash = bcrypt.hashSync('guess', 10)
    usersService.findByEmail.mockResolvedValue({ id: '2', email: 'maria@x.com', role: 'user', password: hash })

    const result = await authService.validateUser('maria@x.com', 'guess')

    expect(result).toEqual({ id: '2', email: 'maria@x.com', role: 'user' })
    expect(result.password).toBeUndefined()
  })

  it('validateUser devuelve null cuando la contraseña no coincide', async () => {
    const hash = bcrypt.hashSync('otra-distinta', 10)
    usersService.findByEmail.mockResolvedValue({ id: '2', email: 'maria@x.com', role: 'user', password: hash })

    const result = await authService.validateUser('maria@x.com', 'guess')

    expect(result).toBeNull()
    expect(auditService.log).toHaveBeenCalled()
  })

  it('validateUser lanza BusinessException cuando el usuario no existe', async () => {
    usersService.findByEmail.mockResolvedValue(null)

    await expect(authService.validateUser('nadie@x.com', 'x')).rejects.toThrow(BusinessException)
    expect(auditService.log).toHaveBeenCalled()
  })

  it('login firma el JWT (payload mínimo) y devuelve el perfil en el body', async () => {
    userRepository.findOne.mockResolvedValue({
      id: '2', email: 'maria@x.com', role: 'user', name: 'Maria', lastName: 'X',
      avatar: null, active: true, subsidiary: null, additionalSubsidiaries: [],
    })

    const result = await authService.login({ id: '2', email: 'maria@x.com', role: 'user' })

    expect(result.access_token).toBe('signed.jwt.token')
    expect(jwtService.sign).toHaveBeenCalledWith({ sub: '2', email: 'maria@x.com', role: 'user' })
    expect(sessionContext.invalidate).toHaveBeenCalledWith('2')
    expect(result.user).toMatchObject({ id: '2', email: 'maria@x.com', subsidiaryIds: ['s1'], permissions: ['p1'] })
  })
})

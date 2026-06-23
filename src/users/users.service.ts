import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BusinessException } from 'src/common/business.exception';
import * as bcrypt from 'bcrypt';
import { Role, User } from 'src/entities';
import { LEGACY_ROLE_MAP } from 'src/auth/rbac/permission-catalog';

/** Rol por defecto (el de menor privilegio) cuando no se especifica uno. */
const DEFAULT_ROLE_KEY = 'user';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Role)
    private roleRepository: Repository<Role>,
) { }

  /**
   * Resuelve la key canónica y el `roleId` (FK) a partir del string de rol
   * recibido (acepta variantes/typos vía LEGACY_ROLE_MAP). Si no se pasa rol,
   * usa el rol más bajo ('user'). Devuelve `roleId: undefined` si la tabla `role`
   * aún no tiene ese rol (no rompe: el `role` string queda igual).
   */
  private async resolveRole(roleString?: string): Promise<{ key: string; roleId?: string }> {
    const requested = (roleString || '').toString().trim().toLowerCase();
    const key = LEGACY_ROLE_MAP[requested] || DEFAULT_ROLE_KEY;
    let role = await this.roleRepository.findOne({ where: { key } });
    if (!role && key !== DEFAULT_ROLE_KEY) {
      role = await this.roleRepository.findOne({ where: { key: DEFAULT_ROLE_KEY } });
    }
    return { key, roleId: role?.id };
  }

  async create(createUserDto: CreateUserDto) {
    // Verificar si el email ya existe
    const existEmail = await this.userRepository.findOne({
        where: { email: createUserDto.email },
    });

    if (existEmail) {
        throw new BusinessException(
            'exercise-api',
            `Email: ${createUserDto.email} already registered`,
            `Email ${createUserDto.email} already registered`,
            HttpStatus.CONFLICT
        );
    }

    // Verificar que la contraseña no sea null o undefined
    if (!createUserDto.password) {
        throw new BusinessException(
            'exercise-api',
            `Password is required`,
            `Password is required`,
            HttpStatus.BAD_REQUEST
        );
    }

    try {
        const saltRounds = 10;
        const salt = await bcrypt.genSalt(saltRounds);
        const hashedPassword = await bcrypt.hash(createUserDto.password, salt);

        // Asigna rol canónico + roleId (FK). Sin rol → el más bajo ('user').
        const { key, roleId } = await this.resolveRole(createUserDto.role);

        const newUser = this.userRepository.create({
            ...createUserDto,
            role: key as User['role'],
            roleId,
            password: hashedPassword,
        });

        return await this.userRepository.save(newUser);
    } catch (error) {
        console.error('Error hashing password:', error);
        throw new BusinessException(
            'exercise-api',
            'Internal server error occurred while creating user',
            'Internal server error',
            HttpStatus.INTERNAL_SERVER_ERROR
        );
    }
  }

  /*async savePasswordReset(email: string, resetToken: string) {
    const user = await this.userRepository.findOneBy({email});

    if(!user) {
      throw new BusinessException(
        'exercise-api',
        `User not exist for email: ${email}`,
        `User not exist for email: ${email}`,
        HttpStatus.CONFLICT
      );
    }

    await this.userRepository.update(user.id, {resetToken});
  }

  async findUserByToken(token: string): Promise<User> {
    const user = await this.userRepository.findOneBy({resetToken: token});

    if (!user) {
      throw new BusinessException(
        'exercise-api',
        'User not found for the given token',
        'User not found for the given token',
        HttpStatus.CONFLICT
      );  
    }

    return user;    
  }*/


  async findAll(): Promise<User[]> {
    return this.userRepository.find({
      relations: ['subsidiary']
    })
  }

  async findOne(id: string) {
    return await this.userRepository.findOneBy({id});
  }

  async findByEmail(email: string){
    const foundUser = await this.userRepository.findOne({ where: { email } , relations: ['subsidiary']})
    
    console.log("🚀 ~ UsersService ~ findByEmail ~ foundUser:", foundUser)
    return foundUser;
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    const user = await this.userRepository.findOneBy({ id });

    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    if (updateUserDto.password === undefined) {
      delete updateUserDto.password;
    } else {
      updateUserDto.password = await bcrypt.hash(updateUserDto.password, 10);
    }

    const updatedUser = this.userRepository.merge(user, updateUserDto);

    // Si se cambió el rol, mantener `roleId` (FK) en sincronía con la key canónica.
    if (updateUserDto.role !== undefined) {
      const { key, roleId } = await this.resolveRole(updateUserDto.role);
      updatedUser.role = key as typeof updatedUser.role;
      updatedUser.roleId = roleId;
    }

    return this.userRepository.save(updatedUser);
  }

  remove(id: string) {
    return this.userRepository.delete(id);
  }

  async bcryptPass(password: string) {
    const hashedPassword = await bcrypt.hash(password, 10);
    return hashedPassword;
  }
}

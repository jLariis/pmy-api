import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from 'src/auth/enums/role.enum';
import { BusinessException } from 'src/common/business.exception';
import * as bcrypt from 'bcrypt';
import { User } from 'src/entities';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>
) { }

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

        const newUser = {
            ...createUserDto,
            password: hashedPassword,
        };

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

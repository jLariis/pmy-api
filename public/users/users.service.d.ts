import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from 'src/users/dto/user.entity';
import { Repository } from 'typeorm';
export declare class UsersService {
    private userRepository;
    constructor(userRepository: Repository<User>);
    create(createUserDto: CreateUserDto): Promise<{
        password: string;
        firstName: string;
        lastName: string;
        email: string;
        role: import("../common/enums/role.enum").Role;
        apartmentNumber: number;
    } & User>;
    savePasswordReset(email: string, resetToken: string): Promise<void>;
    findUserByToken(token: string): Promise<User>;
    findAll(): string;
    findOne(id: string): Promise<User>;
    findByEmail(email: string): Promise<User>;
    update(id: string, updateUserDto: UpdateUserDto): Promise<import("typeorm").UpdateResult>;
    remove(id: string): Promise<import("typeorm").DeleteResult>;
}

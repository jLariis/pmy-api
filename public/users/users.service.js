"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UsersService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const user_entity_1 = require("./dto/user.entity");
const typeorm_2 = require("typeorm");
const business_exception_1 = require("../common/business.exception");
const bcrypt = require("bcrypt");
let UsersService = class UsersService {
    constructor(userRepository) {
        this.userRepository = userRepository;
    }
    async create(createUserDto) {
        const existEmail = await this.userRepository.findOne({
            where: { email: createUserDto.email },
        });
        if (existEmail) {
            throw new business_exception_1.BusinessException('exercise-api', `Email: ${createUserDto.email} already registered`, `Email ${createUserDto.email} already registered`, common_1.HttpStatus.CONFLICT);
        }
        if (!createUserDto.password) {
            throw new business_exception_1.BusinessException('exercise-api', `Password is required`, `Password is required`, common_1.HttpStatus.BAD_REQUEST);
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
        }
        catch (error) {
            console.error('Error hashing password:', error);
            throw new business_exception_1.BusinessException('exercise-api', 'Internal server error occurred while creating user', 'Internal server error', common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    async savePasswordReset(email, resetToken) {
        const user = await this.userRepository.findOneBy({ email });
        if (!user) {
            throw new business_exception_1.BusinessException('exercise-api', `User not exist for email: ${email}`, `User not exist for email: ${email}`, common_1.HttpStatus.CONFLICT);
        }
        await this.userRepository.update(user.id, { resetToken });
    }
    async findUserByToken(token) {
        const user = await this.userRepository.findOneBy({ resetToken: token });
        if (!user) {
            throw new business_exception_1.BusinessException('exercise-api', 'User not found for the given token', 'User not found for the given token', common_1.HttpStatus.CONFLICT);
        }
        return user;
    }
    findAll() {
        return `This action returns all users`;
    }
    async findOne(id) {
        return await this.userRepository.findOneBy({ id });
    }
    async findByEmail(email) {
        return await this.userRepository.findOne({ where: { email } });
    }
    async update(id, updateUserDto) {
        return await this.userRepository.update(id, updateUserDto);
    }
    remove(id) {
        return this.userRepository.delete(id);
    }
};
exports.UsersService = UsersService;
exports.UsersService = UsersService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(user_entity_1.User)),
    __metadata("design:paramtypes", [typeorm_2.Repository])
], UsersService);
//# sourceMappingURL=users.service.js.map
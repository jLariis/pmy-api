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
var AuthService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const jwt_1 = require("@nestjs/jwt");
const users_service_1 = require("../users/users.service");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const bcrypt = require("bcrypt");
const business_exception_1 = require("../common/business.exception");
const user_entity_1 = require("../users/dto/user.entity");
const blacklist_service_1 = require("./blacklist.service");
const email_service_1 = require("./email.service");
const uuid_1 = require("uuid");
let AuthService = AuthService_1 = class AuthService {
    constructor(usersService, jwtService, userRepository, logger, blacklistService, mailService) {
        this.usersService = usersService;
        this.jwtService = jwtService;
        this.userRepository = userRepository;
        this.logger = logger;
        this.blacklistService = blacklistService;
        this.mailService = mailService;
    }
    async validateUser(email, password) {
        const user = await this.usersService.findByEmail(email);
        console.log("🚀 ~ AuthService ~ validateUser ~ user:", user);
        if (!user) {
            throw new business_exception_1.BusinessException('exercise-api', 'Invalid credentials for user ${email}', 'User not found - Invalid credentials', common_1.HttpStatus.UNAUTHORIZED);
        }
        const isMatch = await bcrypt.compare(password, user.password);
        console.log("🚀 ~ AuthService ~ validateUser ~ isMatch:", isMatch);
        this.logger.log(`Login validateUser: ${user}`, AuthService_1.name);
        if (user && isMatch) {
            const { password, ...result } = user;
            this.logger.log(`User && PasswordMatch: ${result}`, AuthService_1.name);
            return result;
        }
        return null;
    }
    async login(user) {
        const payload = { email: user.email, sub: user.id, role: user.role, name: `${user.firstName} ${user.lastName}` };
        this.logger.log(`Login Payload: ${JSON.stringify(payload)}`, AuthService_1.name);
        return {
            access_token: this.jwtService.sign(payload),
            role: payload.role,
            name: payload.name
        };
    }
    async logout(token) {
        return "Logout user.";
        this.blacklistService.add(token);
    }
    async requestPasswordReset(dto) {
        const { email } = dto;
        const resetToken = (0, uuid_1.v4)();
        await this.usersService.savePasswordReset(email, resetToken);
        await this.mailService.sendPasswordResetEmail(email, resetToken);
    }
    async resetPassword(token, newPassword) {
        const user = await this.usersService.findUserByToken(token);
        if (!user) {
            throw new business_exception_1.BusinessException('exercise-api', 'User not exist', 'User not exist', common_1.HttpStatus.CONFLICT);
        }
        try {
            const saltRounds = 10;
            const salt = await bcrypt.genSalt(saltRounds);
            const hashedPassword = await bcrypt.hash(newPassword, salt);
            user.password = hashedPassword;
            user.resetToken = null;
            await this.usersService.update(user.id, user);
        }
        catch (error) {
            console.log("Error traying to hash password: ", error);
        }
    }
    validatePasswordComplexity(password) {
        const minLength = 8;
        const minUppercase = 1;
        const minNumbers = 1;
        const minSpecialChars = 1;
        const uppercaseRegex = /[A-Z]/;
        const numberRegex = /\d/;
        const specialCharsRegex = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]+/;
        if (password.length < minLength ||
            !uppercaseRegex.test(password) ||
            !numberRegex.test(password) ||
            !specialCharsRegex.test(password)) {
            return false;
        }
        return true;
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = AuthService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(2, (0, typeorm_1.InjectRepository)(user_entity_1.User)),
    __param(3, (0, common_1.Inject)(common_1.Logger)),
    __metadata("design:paramtypes", [users_service_1.UsersService,
        jwt_1.JwtService,
        typeorm_2.Repository, Object, blacklist_service_1.BlacklistService,
        email_service_1.EmailService])
], AuthService);
//# sourceMappingURL=auth.service.js.map
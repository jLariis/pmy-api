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
exports.AuthController = void 0;
const common_1 = require("@nestjs/common");
const auth_service_1 = require("./auth.service");
const swagger_1 = require("@nestjs/swagger");
const local_auth_guard_1 = require("./guards/local-auth.guard");
const public_decorator_1 = require("./decorators/decorators/public-decorator");
const app_controller_1 = require("../app.controller");
const AuthDto_1 = require("./dto/AuthDto");
const jwt_auth_guard_1 = require("./guards/jwt-auth.guard");
let AuthController = class AuthController {
    constructor(authService, logger) {
        this.authService = authService;
        this.logger = logger;
    }
    async login(req) {
        this.logger.log('Calling login()', app_controller_1.AppController.name);
        return this.authService.login(req.user);
    }
    async logout(req) {
        this.logger.log('Calling logout()', app_controller_1.AppController.name);
        const token = req.headers.authorization?.split(' ')[1];
        if (token) {
            return await this.authService.logout(token);
        }
    }
    async recoverPassword() {
        this.logger.log('Calling recoverPassword()', app_controller_1.AppController.name);
        return { message: 'Reset password email sent.' };
    }
    ;
    async resetPassword(body) {
        const { token, newPassword } = body;
        await this.authService.resetPassword(token, newPassword);
    }
};
exports.AuthController = AuthController;
__decorate([
    (0, swagger_1.ApiBasicAuth)(),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Correct credentials' }),
    (0, swagger_1.ApiResponse)({ status: 401, description: 'Invalid Credentials' }),
    (0, common_1.UseGuards)(local_auth_guard_1.LocalAuthGuard),
    (0, swagger_1.ApiBody)({ type: AuthDto_1.AuthDto }),
    (0, common_1.Post)('token'),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "login", null);
__decorate([
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Post)('logout'),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "logout", null);
__decorate([
    (0, public_decorator_1.Public)(),
    (0, common_1.Post)('recover'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "recoverPassword", null);
__decorate([
    (0, common_1.Post)('reset-password'),
    (0, public_decorator_1.Public)(),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Password successfully updated.' }),
    (0, swagger_1.ApiResponse)({ status: 400, description: 'Invalid token or failed to update password.' }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "resetPassword", null);
exports.AuthController = AuthController = __decorate([
    (0, swagger_1.ApiTags)('auth'),
    (0, common_1.Controller)('auth'),
    __param(1, (0, common_1.Inject)(common_1.Logger)),
    __metadata("design:paramtypes", [auth_service_1.AuthService, Object])
], AuthController);
//# sourceMappingURL=auth.controller.js.map
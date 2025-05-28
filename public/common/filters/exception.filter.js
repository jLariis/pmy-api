"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var CustomExceptionFilter_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CustomExceptionFilter = void 0;
const common_1 = require("@nestjs/common");
const business_exception_1 = require("../business.exception");
let CustomExceptionFilter = CustomExceptionFilter_1 = class CustomExceptionFilter {
    constructor() {
        this.logger = new common_1.Logger(CustomExceptionFilter_1.name);
    }
    catch(exception, host) {
        let body;
        let status;
        if (exception instanceof business_exception_1.BusinessException) {
            body = {
                id: exception.id,
                message: exception.apiMessage,
                domain: exception.domain,
                timestamp: exception.timestamp,
            };
            status = exception.status;
        }
        else if (exception instanceof common_1.HttpException) {
            if (exception.getStatus() === common_1.HttpStatus.BAD_REQUEST) {
                body = new business_exception_1.BusinessException('generic', exception.getResponse()['message'][0], exception.getResponse()['message'][0], exception.getStatus());
                status = exception.getStatus();
            }
            else {
                body = new business_exception_1.BusinessException('generic', exception.message, exception.message, exception.getStatus());
                status = exception.getStatus();
            }
        }
        else {
            body = new business_exception_1.BusinessException('generic', `Internal error occurred: ${exception.message}`, `Internal error occurred: ${exception.message}`, common_1.HttpStatus.INTERNAL_SERVER_ERROR);
            status = common_1.HttpStatus.INTERNAL_SERVER_ERROR;
        }
        const ctx = host.switchToHttp();
        const response = ctx.getResponse();
        const request = ctx.getRequest();
        this.logger.error(`Got an exception: ${JSON.stringify({
            path: request.url,
            ...body,
        })}. Exception: ${JSON.stringify(exception)}`);
        response.status(status).json(body);
    }
};
exports.CustomExceptionFilter = CustomExceptionFilter;
exports.CustomExceptionFilter = CustomExceptionFilter = CustomExceptionFilter_1 = __decorate([
    (0, common_1.Catch)(Error)
], CustomExceptionFilter);
//# sourceMappingURL=exception.filter.js.map
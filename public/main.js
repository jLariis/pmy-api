"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const app_module_1 = require("./app.module");
const swagger_1 = require("@nestjs/swagger");
const exception_filter_1 = require("./common/filters/exception.filter");
const winston_1 = require("winston");
const nest_winston_1 = require("nest-winston");
require("winston-daily-rotate-file");
const common_1 = require("@nestjs/common");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule, {
        logger: nest_winston_1.WinstonModule.createLogger({
            transports: [
                new winston_1.transports.DailyRotateFile({
                    filename: `logs/%DATE%-error.log`,
                    level: 'error',
                    format: winston_1.format.combine(winston_1.format.timestamp(), winston_1.format.json()),
                    datePattern: 'DD-MM-YYYY',
                    zippedArchive: false,
                }),
                new winston_1.transports.DailyRotateFile({
                    filename: `logs/%DATE%-combined.log`,
                    format: winston_1.format.combine(winston_1.format.timestamp(), winston_1.format.json()),
                    datePattern: 'DD-MM-YYYY',
                    zippedArchive: false,
                }),
                new winston_1.transports.Console({
                    format: winston_1.format.combine(winston_1.format.cli(), winston_1.format.splat(), winston_1.format.timestamp(), winston_1.format.printf((info) => {
                        return `${info.timestamp} ${info.level}: ${info.message}`;
                    })),
                }),
            ],
        }),
    });
    const port = process.env.PORT || 8080;
    app.setGlobalPrefix('api');
    const swagger = new swagger_1.DocumentBuilder()
        .setTitle('PMY API')
        .setDescription('API for Paquetería del Yaqui.')
        .setVersion('1.0')
        .addBearerAuth()
        .build();
    const document = swagger_1.SwaggerModule.createDocument(app, swagger);
    swagger_1.SwaggerModule.setup('swagger', app, document);
    app.useGlobalFilters(new exception_filter_1.CustomExceptionFilter());
    app.useGlobalPipes(new common_1.ValidationPipe());
    app.enableCors();
    await app.listen(port);
}
bootstrap();
//# sourceMappingURL=main.js.map
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { CustomExceptionFilter } from './common/filters/exception.filter';
import { transports, format } from 'winston';
import { WinstonModule } from 'nest-winston';
import "winston-daily-rotate-file";
import { ValidationPipe } from '@nestjs/common';


async function bootstrap() {
  process.env.TZ = 'UTC'; // Configurar zona horaria
  
  const app = await NestFactory.create(AppModule, {
    logger: WinstonModule.createLogger({
      transports: [
        // file on daily rotation (error only)
        new transports.DailyRotateFile({
          // %DATE will be replaced by the current date
          filename: `logs/%DATE%-error.log`,
          level: 'error',
          format: format.combine(format.timestamp(), format.json()),
          datePattern: 'DD-MM-YYYY',
          zippedArchive: false, // don't want to zip our logs
        }),
        // same for all levels
        new transports.DailyRotateFile({
          filename: `logs/%DATE%-combined.log`,
          format: format.combine(format.timestamp(), format.json()),
          datePattern: 'DD-MM-YYYY',
          zippedArchive: false,
        }),
        new transports.Console({
          format: format.combine(
              format.cli(),
              format.splat(),
              format.timestamp(),
              format.printf((info) => {
                return `${info.timestamp} ${info.level}: ${info.message}`;
              }),
          ),
        }),
      ],
    }),
  });

  const port = process.env.PORT || 8080;
  
  app.setGlobalPrefix('api', {
    exclude: ['/']
  });

  const swagger = new DocumentBuilder()
    .setTitle('PMY API')
    .setDescription('API for Paquetería del Yaqui.')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, swagger);
  SwaggerModule.setup('swagger', app, document);

  // Use custom errors & logger
  app.useGlobalFilters(new CustomExceptionFilter());
  app.useGlobalPipes(new ValidationPipe());
  app.enableCors();

  await app.listen(port);
}
bootstrap();

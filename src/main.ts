import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { CustomExceptionFilter } from './common/filters/exception.filter';
import { transports, format } from 'winston';
import { WinstonModule } from 'nest-winston';
import 'winston-daily-rotate-file';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  process.env.TZ = 'UTC';

  const isDevelopment = process.env.NODE_ENV === 'develop';
  const logLevel = isDevelopment ? 'debug' : 'info';

  const app = await NestFactory.create(AppModule, {
    logger: WinstonModule.createLogger({
      level: logLevel,
      transports: [
        new transports.DailyRotateFile({
          filename: `logs/%DATE%-error.log`,
          level: 'error',
          format: format.combine(format.timestamp(), format.json()),
          datePattern: 'DD-MM-YYYY',
          zippedArchive: false,
        }),
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

  const port = process.env.PORT || 3001;

  app.setGlobalPrefix('api', {
    exclude: ['/'],
  });

  const swagger = new DocumentBuilder()
    .setTitle('PMY API')
    .setDescription('API for Paquetería del Yaqui.')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, swagger);
  SwaggerModule.setup('swagger', app, document);

  app.useGlobalFilters(new CustomExceptionFilter());
  app.useGlobalPipes(new ValidationPipe());

  // ✅ CORS DEFINITIVO
  app.enableCors({
    origin: (origin, callback) => {
      // Permitir requests sin origin (Postman, apps nativas, Electron, etc.)
      if (!origin) return callback(null, true);

      // ✅ Solo Vercel del proyecto app-pmy
      if (
        origin.endsWith('.vercel.app') &&
        origin.includes('app-pmy')
      ) {
        return callback(null, true);
      }

      // Desarrollo / apps locales / nativas
      if (
        origin.includes('localhost') ||
        origin.startsWith('file://') ||
        origin.startsWith('app://') ||
        origin.startsWith('capacitor://')
      ) {
        return callback(null, true);
      }

      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'X-Requested-With'
    ],
    credentials: true,
    optionsSuccessStatus: 204,
  });

  await app.listen(port);
}

bootstrap();

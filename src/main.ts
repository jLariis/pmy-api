import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { CustomExceptionFilter } from './common/filters/exception.filter';
import { transports, format } from 'winston';
import { WinstonModule } from 'nest-winston';
import 'winston-daily-rotate-file';
import { ValidationPipe } from '@nestjs/common';
import * as express from 'express';

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

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ limit: '1mb', extended: true }));

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

  // ✅ CORS BIEN CONFIGURADO
  const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:4000', 
    'http://127.0.0.1:4000',
    'https://pc4gjn47-3000.usw3.devtunnels.ms',
    'https://pc4gjn47-4000.usw3.devtunnels.ms'
  ];

  app.enableCors({
    origin: (origin, callback) => {
      // Permitir requests sin origin (Postman, mobile, etc.)
      if (!origin) return callback(null, true);

      // Exact match (local)
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      // Devtunnels (dinámico)
      if (origin.includes('devtunnels.ms')) {
        return callback(null, true);
      }

      // Vercel (tu app)
      if (
        origin.endsWith('.vercel.app') &&
        origin.includes('app-pmy')
      ) {
        return callback(null, true);
      }

      // Apps nativas
      if (
        origin.startsWith('file://') ||
        origin.startsWith('app://') ||
        origin.startsWith('capacitor://')
      ) {
        return callback(null, true);
      }

      // ❗ No lanzar error (esto rompía tu CORS)
      return callback(null, false);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'X-Requested-With',
    ],
    credentials: true,
    optionsSuccessStatus: 204,
  });

  await app.listen(port);
}

bootstrap();
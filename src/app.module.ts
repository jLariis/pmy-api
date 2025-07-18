import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { config } from './config/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseConfig } from './config/db/database.config';
import { UsersModule } from './users/users.module';
import { Logger } from 'winston';
import { ScheduleModule } from '@nestjs/schedule';
import { ShipmentsModule } from './shipments/shipments.module';
import { SubsidiariesModule } from './subsidiaries/subsidiaries.module';
import { IncomeModule } from './income/income.module';
import { CollectionModule } from './collections/collections.module';
import { ExpensesModule } from './expenses/expenses.module';
import { ConsolidatedModule } from './consolidated/consolidated.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { MailerModule } from '@nestjs-modules/mailer';

@Module({
  imports: [
    AuthModule,
    ScheduleModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
      load: [config]
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useClass: DatabaseConfig
    }),
    MailerModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        transport: {
          host: configService.get<string>('EMAIL_SERVICE_HOST'),
          port: parseInt(configService.get<string>('EMAIL_SERVICE_PORT') ?? '587'),
          secure: configService.get<string>('EMAIL_SERVICE_SECURE') === 'true',
          auth: {
            user: configService.get<string>('EMAIL_SERVICE_EMAIL'),
            pass: configService.get<string>('EMAIL_SERVICE_PASSWORD'),
          },
        },
        defaults: {
          from: `"PMY App" <${configService.get<string>('EMAIL_SERVICE_EMAIL')}>`,
        },
      }),
      inject: [ConfigService],
    }),
    UsersModule,
    ShipmentsModule,
    SubsidiariesModule,
    IncomeModule,
    CollectionModule,
    ExpensesModule,
    ConsolidatedModule,
    DashboardModule
  ],
  controllers: [AppController],
  providers: [
    Logger,
    AppService,
  ],
})
export class AppModule {}

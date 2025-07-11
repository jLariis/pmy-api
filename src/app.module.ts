import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from '@nestjs/config';
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

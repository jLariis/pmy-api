import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReturningService } from './returning.service';
import { ReturningController } from './returning.controller';
import { ReturningHistory } from 'src/entities/returning-history.entity';
import { Devolution, Collection, Subsidiary } from 'src/entities';
import { DevolutionsModule } from 'src/devolutions/devolutions.module';
import { CollectionModule } from 'src/collections/collections.module';
import { EmailLogModule } from 'src/email-log/email-log.module';
import { DocumentsModule } from 'src/documents/documents.module';
import { MailService } from 'src/mail/mail.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ReturningHistory, Devolution, Collection, Subsidiary]),
    DevolutionsModule,
    CollectionModule,
    EmailLogModule,
    DocumentsModule,
  ],
  controllers: [ReturningController],
  providers: [ReturningService, MailService],
})
export class ReturningModule {}

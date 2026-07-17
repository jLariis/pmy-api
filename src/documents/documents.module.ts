import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Brand } from 'src/entities/brand.entity';
import { DocumentTemplate } from 'src/entities/document-template.entity';
import { DocumentTemplateVersion } from 'src/entities/document-template-version.entity';
import { TemplateVariableDef } from 'src/entities/template-variable-def.entity';
import { TemplateRenderLog } from 'src/entities/template-render-log.entity';
import { TemplateEngine } from './template-engine';
import { BrandingService } from './branding.service';
import { VariableResolver } from './variable-resolver.service';
import { RendererRegistry } from './renderer.registry';
import { FallbackRenderer } from './fallback.renderer';
import { TemplateStore } from './template-store.service';
import { TemplateService } from './template.service';
import { EmailRenderer } from './renderers/email.renderer';
import { PdfRenderer } from './renderers/pdf.renderer';
import { ExcelRenderer } from './renderers/excel.renderer';
import { BlockComposer } from './blocks/block-composer';
import { PdfHtmlComposer } from './blocks/pdf-html-composer';
import { HtmlToPdfService } from './html-to-pdf.service';
import { ExcelWorkbookBuilder } from './blocks/excel-workbook-builder';
import { DOCUMENT_RENDERERS } from './renderers/renderer.interface';
import { TemplateAdminService } from './admin/template-admin.service';
import { MailService } from 'src/mail/mail.service';
import { TemplatesController } from './admin/templates.controller';
import { BrandController } from './admin/brand.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Brand, DocumentTemplate, DocumentTemplateVersion, TemplateVariableDef, TemplateRenderLog,
    ]),
  ],
  controllers: [TemplatesController, BrandController],
  providers: [
    TemplateEngine,
    BrandingService,
    VariableResolver,
    FallbackRenderer,
    TemplateStore,
    TemplateService,
    BlockComposer,
    PdfHtmlComposer,
    HtmlToPdfService,
    ExcelWorkbookBuilder,
    EmailRenderer,
    PdfRenderer,
    ExcelRenderer,
    { provide: DOCUMENT_RENDERERS, useFactory: (email: EmailRenderer, pdf: PdfRenderer, excel: ExcelRenderer) => [email, pdf, excel], inject: [EmailRenderer, PdfRenderer, ExcelRenderer] },
    RendererRegistry,
    TemplateAdminService,
    MailService,
  ],
  exports: [TemplateService, BrandingService, TemplateStore, TemplateAdminService],
})
export class DocumentsModule {}

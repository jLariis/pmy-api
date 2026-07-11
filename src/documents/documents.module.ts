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
import { DOCUMENT_RENDERERS } from './renderers/renderer.interface';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Brand, DocumentTemplate, DocumentTemplateVersion, TemplateVariableDef, TemplateRenderLog,
    ]),
  ],
  providers: [
    TemplateEngine,
    BrandingService,
    VariableResolver,
    FallbackRenderer,
    TemplateStore,
    TemplateService,
    EmailRenderer,
    { provide: DOCUMENT_RENDERERS, useFactory: (email: EmailRenderer) => [email], inject: [EmailRenderer] },
    RendererRegistry,
  ],
  exports: [TemplateService, BrandingService, TemplateStore],
})
export class DocumentsModule {}

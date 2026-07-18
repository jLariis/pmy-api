import { Injectable, Logger } from '@nestjs/common';
import { DocumentFormat } from 'src/entities/document-template.entity';
import { DocumentTemplateVersion } from 'src/entities/document-template-version.entity';
import { TemplateEngine } from '../template-engine';
import { PdfHtmlComposer } from '../blocks/pdf-html-composer';
import { HtmlToPdfService } from '../html-to-pdf.service';
import { RenderContext, RenderResult } from '../documents.types';
import { DocumentRenderer } from './renderer.interface';

@Injectable()
export class PdfRenderer implements DocumentRenderer {
  readonly format: DocumentFormat = 'pdf';
  private readonly logger = new Logger(PdfRenderer.name);

  constructor(
    private readonly engine: TemplateEngine,
    private readonly composer: PdfHtmlComposer,
    private readonly htmlToPdf: HtmlToPdfService,
  ) {}

  async render(version: DocumentTemplateVersion, ctx: RenderContext): Promise<RenderResult> {
    try {
      const doc: any = version.designJson;
      const template = doc && (doc.html || doc.blocks) ? this.composer.compose(doc) : '';
      const html = this.engine.render(template, ctx);
      const buffer = await this.htmlToPdf.convert(html);
      return { format: 'pdf', mime: 'application/pdf', buffer, html };
    } catch (e: any) {
      this.logger.warn(`render PDF falló (designJson inválido o sin Chromium?): ${e?.message}`);
      return { format: 'pdf', mime: 'application/pdf' }; // sin buffer/html → el llamador cae a legacy
    }
  }
}

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
    const doc: any = version.designJson;
    const template = doc && doc.blocks ? this.composer.compose(doc) : '';
    const html = this.engine.render(template, ctx);
    try {
      const buffer = await this.htmlToPdf.convert(html);
      return { format: 'pdf', mime: 'application/pdf', buffer, html };
    } catch (e: any) {
      this.logger.warn(`conversión PDF falló (sin Chromium?): ${e?.message}`);
      return { format: 'pdf', mime: 'application/pdf', html }; // sin buffer → el llamador cae a legacy
    }
  }
}

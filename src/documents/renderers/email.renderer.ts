import { Injectable } from '@nestjs/common';
import mjml2html = require('mjml');
import { DocumentFormat } from 'src/entities/document-template.entity';
import { DocumentTemplateVersion } from 'src/entities/document-template-version.entity';
import { TemplateEngine } from '../template-engine';
import { RenderContext, RenderResult } from '../documents.types';
import { DocumentRenderer } from './renderer.interface';
import { BlockComposer } from '../blocks/block-composer';

@Injectable()
export class EmailRenderer implements DocumentRenderer {
  readonly format: DocumentFormat = 'email';

  constructor(
    private readonly engine: TemplateEngine,
    private readonly composer: BlockComposer,
  ) {}

  async render(version: DocumentTemplateVersion, ctx: RenderContext): Promise<RenderResult> {
    const subject = this.engine.render(version.subject ?? '', ctx);
    // Preferir bloques (designJson.blocks); fallback a compiledBody MJML legacy.
    const doc: any = version.designJson;
    const source = doc && Array.isArray(doc.blocks) ? this.composer.compose(doc) : (version.compiledBody ?? '');
    const rendered = this.engine.render(source, ctx);
    const html = rendered.includes('<mjml')
      ? (await (mjml2html as any)(rendered, { validationLevel: 'soft' })).html
      : rendered;
    return { format: 'email', mime: 'text/html', subject, html };
  }
}

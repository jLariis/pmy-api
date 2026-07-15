import { Inject, Injectable } from '@nestjs/common';
import { DocumentFormat } from 'src/entities/document-template.entity';
import { DOCUMENT_RENDERERS, DocumentRenderer } from './renderers/renderer.interface';

@Injectable()
export class RendererRegistry {
  private readonly byFormat = new Map<DocumentFormat, DocumentRenderer>();

  constructor(@Inject(DOCUMENT_RENDERERS) renderers: DocumentRenderer[]) {
    for (const r of renderers) this.byFormat.set(r.format, r);
  }

  get(format: DocumentFormat): DocumentRenderer {
    const r = this.byFormat.get(format);
    if (!r) throw new Error(`No hay renderer registrado para el formato '${format}'`);
    return r;
  }
}

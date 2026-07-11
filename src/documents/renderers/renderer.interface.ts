import { DocumentFormat } from 'src/entities/document-template.entity';
import { DocumentTemplateVersion } from 'src/entities/document-template-version.entity';
import { RenderContext, RenderResult } from '../documents.types';

/** Contrato que implementa cada formato de salida (email, pdf, excel, …). */
export interface DocumentRenderer {
  readonly format: DocumentFormat;
  render(version: DocumentTemplateVersion, ctx: RenderContext): Promise<RenderResult>;
}

/** Token DI para coleccionar todos los renderers registrados. */
export const DOCUMENT_RENDERERS = Symbol('DOCUMENT_RENDERERS');

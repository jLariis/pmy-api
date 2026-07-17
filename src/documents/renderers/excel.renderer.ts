import { Injectable, Logger } from '@nestjs/common';
import { DocumentFormat } from 'src/entities/document-template.entity';
import { DocumentTemplateVersion } from 'src/entities/document-template-version.entity';
import { ExcelWorkbookBuilder } from '../blocks/excel-workbook-builder';
import { RenderContext, RenderResult } from '../documents.types';
import { DocumentRenderer } from './renderer.interface';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@Injectable()
export class ExcelRenderer implements DocumentRenderer {
  readonly format: DocumentFormat = 'excel';
  private readonly logger = new Logger(ExcelRenderer.name);

  constructor(private readonly builder: ExcelWorkbookBuilder) {}

  async render(version: DocumentTemplateVersion, ctx: RenderContext): Promise<RenderResult> {
    const doc: any = version.designJson;
    try {
      const buffer = await this.builder.build(doc, ctx);
      return { format: 'excel', mime: XLSX_MIME, buffer };
    } catch (e: any) {
      this.logger.warn(`build Excel falló: ${e?.message}`);
      return { format: 'excel', mime: XLSX_MIME };
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DocumentTemplate } from 'src/entities/document-template.entity';
import { TemplateVariableDef } from 'src/entities/template-variable-def.entity';
import { BrandingService } from './branding.service';
import { RenderContext } from './documents.types';

@Injectable()
export class VariableResolver {
  private readonly logger = new Logger(VariableResolver.name);

  constructor(
    @InjectRepository(TemplateVariableDef) private readonly varRepo: Repository<TemplateVariableDef>,
    private readonly branding: BrandingService,
  ) {}

  async build(template: DocumentTemplate, data: Record<string, any>): Promise<RenderContext> {
    const defs = await this.varRepo.find({ where: { templateId: template.id } });
    for (const d of defs) {
      if (d.required && (data?.[d.name] === undefined || data?.[d.name] === null)) {
        this.logger.warn(`Variable required faltante '${d.name}' en plantilla ${template.code}`);
      }
    }
    const brand = await this.branding.getTokens();
    return {
      data: data ?? {},
      brand,
      system: { now: new Date(), appUrl: process.env.FRONTEND_URL ?? 'https://app-pmy.vercel.app/', env: process.env.NODE_ENV ?? 'production' },
    };
  }
}

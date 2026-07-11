import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TemplateRenderLog, RenderStatus } from 'src/entities/template-render-log.entity';
import { TemplateStore } from './template-store.service';
import { RendererRegistry } from './renderer.registry';
import { VariableResolver } from './variable-resolver.service';
import { FallbackRenderer } from './fallback.renderer';
import { RenderResult } from './documents.types';

@Injectable()
export class TemplateService {
  private readonly logger = new Logger(TemplateService.name);

  constructor(
    private readonly store: TemplateStore,
    private readonly registry: RendererRegistry,
    private readonly resolver: VariableResolver,
    private readonly fallback: FallbackRenderer,
    @InjectRepository(TemplateRenderLog) private readonly logRepo: Repository<TemplateRenderLog>,
  ) {}

  async render(code: string, data: Record<string, any>): Promise<RenderResult> {
    const started = Date.now();
    try {
      const { template, version } = await this.store.getActive(code);
      const renderer = this.registry.get(template.type);
      const ctx = await this.resolver.build(template, data);
      const result = await renderer.render(version, ctx);
      void this.log(code, version.version, result.format, 'ok', started, data);
      return result;
    } catch (err: any) {
      this.logger.warn(`render(${code}) fallback: ${err?.message}`);
      const result = await this.fallback.render(code, data);
      void this.log(code, 0, result.format, 'fallback', started, data, err?.message);
      return result;
    }
  }

  async renderPreview(code: string, sampleData: Record<string, any>): Promise<RenderResult> {
    return this.render(code, sampleData);
  }

  private async log(code: string, version: number, format: string, status: RenderStatus, started: number, data: any, error?: string) {
    try {
      await this.logRepo.save(this.logRepo.create({
        code, version, format, status,
        entityId: data?.id ?? data?.entityId ?? null,
        ms: Date.now() - started,
        error: error ?? null,
      }));
    } catch (e: any) {
      this.logger.warn(`No se pudo registrar render log: ${e?.message}`);
    }
  }
}

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DocumentTemplate } from 'src/entities/document-template.entity';
import { DocumentTemplateVersion } from 'src/entities/document-template-version.entity';

interface ActiveTemplate { template: DocumentTemplate; version: DocumentTemplateVersion; }

@Injectable()
export class TemplateStore {
  private cache = new Map<string, ActiveTemplate>();

  constructor(
    @InjectRepository(DocumentTemplate) private readonly tplRepo: Repository<DocumentTemplate>,
    @InjectRepository(DocumentTemplateVersion) private readonly verRepo: Repository<DocumentTemplateVersion>,
  ) {}

  async getActive(code: string): Promise<ActiveTemplate> {
    const cached = this.cache.get(code);
    if (cached) return cached;

    const template = await this.tplRepo.findOne({ where: { code, active: true } });
    if (!template) throw new Error(`Plantilla '${code}' no existe o está inactiva`);
    if (!template.currentVersionId) throw new Error(`Plantilla '${code}' sin versión publicada`);

    const version = await this.verRepo.findOne({ where: { id: template.currentVersionId } });
    if (!version || version.status !== 'published') throw new Error(`Plantilla '${code}' sin versión publicada válida`);

    const result = { template, version };
    this.cache.set(code, result);
    return result;
  }

  invalidate(code?: string): void {
    if (code) this.cache.delete(code);
    else this.cache.clear();
  }
}

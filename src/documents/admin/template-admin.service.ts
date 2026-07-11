import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DocumentTemplate, DocumentFormat } from 'src/entities/document-template.entity';
import { DocumentTemplateVersion } from 'src/entities/document-template-version.entity';
import { Brand } from 'src/entities/brand.entity';
import { TemplateStore } from '../template-store.service';
import { BrandingService } from '../branding.service';

type Actor = { id?: string; name?: string };

@Injectable()
export class TemplateAdminService {
  constructor(
    @InjectRepository(DocumentTemplate) private readonly tplRepo: Repository<DocumentTemplate>,
    @InjectRepository(DocumentTemplateVersion) private readonly verRepo: Repository<DocumentTemplateVersion>,
    @InjectRepository(Brand) private readonly brandRepo: Repository<Brand>,
    private readonly store: TemplateStore,
    private readonly branding: BrandingService,
  ) {}

  createTemplate(input: { code: string; name: string; type: DocumentFormat; description?: string; category?: string }) {
    return this.tplRepo.save(this.tplRepo.create({ ...input, language: 'es', active: true }));
  }

  private async require(templateId: string): Promise<DocumentTemplate> {
    const t = await this.tplRepo.findOne({ where: { id: templateId } });
    if (!t) throw new NotFoundException(`Plantilla ${templateId} no existe`);
    return t;
  }

  private async nextVersionNumber(templateId: string): Promise<number> {
    const all = await this.verRepo.find({ where: { templateId } });
    return all.reduce((m, v) => Math.max(m, v.version), 0) + 1;
  }

  async saveDraft(templateId: string, input: { subject?: string; designJson?: any; compiledBody?: string; changelog?: string }, actor: Actor) {
    await this.require(templateId);
    const all = await this.verRepo.find({ where: { templateId } });
    const draft = all.filter((v) => v.status === 'draft').sort((a, b) => b.version - a.version)[0];
    if (draft) {
      Object.assign(draft, {
        subject: input.subject ?? draft.subject,
        designJson: input.designJson ?? draft.designJson,
        compiledBody: input.compiledBody ?? draft.compiledBody,
        changelog: input.changelog ?? draft.changelog,
      });
      return this.verRepo.save(draft);
    }
    return this.verRepo.save(this.verRepo.create({
      templateId,
      version: await this.nextVersionNumber(templateId),
      status: 'draft',
      subject: input.subject ?? null,
      designJson: input.designJson ?? null,
      compiledBody: input.compiledBody ?? null,
      engine: 'handlebars',
      changelog: input.changelog ?? null,
      createdById: actor.id ?? null,
      createdByName: actor.name ?? null,
    }));
  }

  async publish(templateId: string, versionId: string, _actor: Actor) {
    const template = await this.require(templateId);
    const version = await this.verRepo.findOne({ where: { id: versionId } });
    if (!version) throw new NotFoundException(`Versión ${versionId} no existe`);

    if (template.currentVersionId) {
      const prev = await this.verRepo.findOne({ where: { id: template.currentVersionId } });
      if (prev && prev.status === 'published') { prev.status = 'archived'; await this.verRepo.save(prev); }
    }
    version.status = 'published';
    version.publishedAt = new Date();
    await this.verRepo.save(version);

    template.currentVersionId = version.id;
    await this.tplRepo.save(template);
    this.store.invalidate(template.code);
    return template;
  }

  async restore(templateId: string, fromVersionId: string, actor: Actor) {
    await this.require(templateId);
    const from = await this.verRepo.findOne({ where: { id: fromVersionId } });
    if (!from) throw new NotFoundException(`Versión ${fromVersionId} no existe`);
    return this.verRepo.save(this.verRepo.create({
      templateId,
      version: await this.nextVersionNumber(templateId),
      status: 'draft',
      subject: from.subject,
      designJson: from.designJson,
      compiledBody: from.compiledBody,
      engine: from.engine,
      changelog: `Restaurado desde v${from.version}`,
      createdById: actor.id ?? null,
      createdByName: actor.name ?? null,
    }));
  }

  listVersions(templateId: string) {
    return this.verRepo.find({ where: { templateId }, order: { version: 'DESC' } });
  }

  list() {
    return this.tplRepo.find({ order: { code: 'ASC' } });
  }

  getByCode(code: string) {
    return this.tplRepo.findOne({ where: { code } });
  }

  async getBrand() {
    return (await this.brandRepo.findOne({ where: { key: 'default' } })) ?? this.brandRepo.create({ key: 'default' });
  }

  async upsertBrand(input: Partial<Brand>, _actor: Actor) {
    const existing = await this.brandRepo.findOne({ where: { key: 'default' } });
    const row = existing ? Object.assign(existing, input) : this.brandRepo.create({ ...input, key: 'default' });
    row.updatedAt = new Date();
    const saved = await this.brandRepo.save(row);
    this.branding.invalidate();
    return saved;
  }
}

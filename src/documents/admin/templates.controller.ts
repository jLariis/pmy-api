import { Body, Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SuperAdminGuard } from 'src/audit/super-admin.guard';
import { MailService } from 'src/mail/mail.service';
import { TemplateAdminService } from './template-admin.service';
import { TemplateService } from '../template.service';
import { CreateTemplateDto, SaveDraftDto, PublishDto, RestoreDto, TestSendDto, PreviewDto } from './dto/template.dto';

@ApiTags('documents')
@ApiBearerAuth()
@UseGuards(SuperAdminGuard)
@Controller('documents/templates')
export class TemplatesController {
  constructor(
    private readonly admin: TemplateAdminService,
    private readonly templates: TemplateService,
    private readonly mail: MailService,
  ) {}

  @Get() list() { return this.admin.list(); }

  @Get(':code') getByCode(@Param('code') code: string) { return this.admin.getByCode(code); }

  @Post() create(@Body() dto: CreateTemplateDto) { return this.admin.createTemplate(dto); }

  @Post(':id/draft')
  saveDraft(@Param('id') id: string, @Body() dto: SaveDraftDto, @Request() req) {
    return this.admin.saveDraft(id, dto, { id: req.user?.userId, name: req.user?.name });
  }

  @Post(':id/publish')
  publish(@Param('id') id: string, @Body() dto: PublishDto, @Request() req) {
    return this.admin.publish(id, dto.versionId, { id: req.user?.userId, name: req.user?.name });
  }

  @Post(':id/restore')
  restore(@Param('id') id: string, @Body() dto: RestoreDto, @Request() req) {
    return this.admin.restore(id, dto.fromVersionId, { id: req.user?.userId, name: req.user?.name });
  }

  @Get(':id/versions') versions(@Param('id') id: string) { return this.admin.listVersions(id); }

  @Post(':code/preview')
  preview(@Param('code') code: string, @Body() dto: PreviewDto) {
    return this.templates.renderPreview(code, dto.sampleData ?? {});
  }

  @Post(':code/test-send')
  async testSend(@Param('code') code: string, @Body() dto: TestSendDto) {
    const r = await this.templates.renderPreview(code, dto.sampleData ?? {});
    await this.mail.sendEmailNotification({ to: dto.to, subject: r.subject ?? 'Prueba PMY', htmlContent: r.html ?? '' });
    return { ok: true };
  }
}

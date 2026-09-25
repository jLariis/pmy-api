import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { MaintenanceRequest } from 'src/entities/maintenance-request.entity';
import { RequestDispatch } from 'src/entities/request-dispatch.entity';
import { Supplier } from 'src/entities/supplier.entity';
import { CONTACT_CHANNELS, ContactChannel, SupplierContact } from 'src/entities/supplier-contact.entity';
import { User } from 'src/entities/user.entity';
import { TemplateService } from 'src/documents/template.service';
import { BrandingService } from 'src/documents/branding.service';
import { MailService } from 'src/mail/mail.service';
import { EmailLogService } from 'src/email-log/email-log.service';
import { WhatsappGatewayService } from 'src/whatsapp-gateway/whatsapp-gateway.service';
import { EmailStatus } from 'src/common/enums/email-status.enum';
import { ScopeUser, userDisplayName } from '../maintenance-scope.util';
import { isPurchaser } from '../maintenance.permissions';
import { ComparisonService } from '../requests/comparison.service';
import { resolveDestination } from './po-dispatch.service';
import { mapComparisonToPdf, mapRequestToRfqPdf } from './purchase-pdf.mappers';

export const RFQ_EMAIL_MODULE = 'purchase_request';

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export class RfqTargetDto {
  @IsUUID('all', { message: 'Proveedor no reconocido' })
  supplierId: string;

  @IsOptional() @IsUUID('all', { message: 'Contacto no reconocido' })
  contactId?: string;

  @IsOptional() @IsIn(CONTACT_CHANNELS, { message: 'Elige correo o WhatsApp' })
  channel?: ContactChannel;
}

export class SendRfqDto {
  @IsArray() @ArrayMinSize(1, { message: 'Elige al menos un proveedor' }) @ValidateNested({ each: true }) @Type(() => RfqTargetDto)
  targets: RfqTargetDto[];

  @IsOptional() @IsString() @MaxLength(1000, { message: 'Las notas no pueden pasar de 1000 caracteres' })
  notes?: string;
}

export interface RfqResult {
  supplierId: string;
  supplierName: string;
  ok: boolean;
  channel?: ContactChannel;
  destination?: string;
  error?: string;
}

/** "Pedir cotización" a proveedores (PDF por correo/WhatsApp, con bitácora) y PDF del comparativo. */
@Injectable()
export class RequestDispatchService {
  private readonly logger = new Logger(RequestDispatchService.name);

  constructor(
    @InjectRepository(MaintenanceRequest) private readonly requests: Repository<MaintenanceRequest>,
    @InjectRepository(RequestDispatch) private readonly dispatches: Repository<RequestDispatch>,
    @InjectRepository(Supplier) private readonly suppliers: Repository<Supplier>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly comparison: ComparisonService,
    private readonly templates: TemplateService,
    private readonly branding: BrandingService,
    private readonly mail: MailService,
    private readonly emailLog: EmailLogService,
    private readonly whatsapp: WhatsappGatewayService,
  ) {}

  private async loadRequest(id: string) {
    const r = await this.requests.findOne({
      where: { id },
      relations: ['items', 'items.unit', 'items.product', 'vehicle', 'subsidiary'],
    });
    if (!r) throw new NotFoundException('Solicitud no encontrada');
    return r;
  }

  private async sender(user: ScopeUser) {
    const u = user?.userId ? await this.users.findOne({ where: { id: user.userId }, select: ['id', 'name', 'lastName', 'email'] }) : null;
    return { name: userDisplayName(u ?? user), email: u?.email ?? user?.email ?? null };
  }

  history(requestId: string) {
    return this.dispatches.find({ where: { requestId }, relations: ['supplier'], order: { sentAt: 'DESC' } });
  }

  /** PDF de la solicitud de cotización (para descargar/imprimir). Con proveedor, va dirigido a él. */
  async rfqPdf(requestId: string, user: ScopeUser, supplierId?: string) {
    if (!isPurchaser(user)) throw new ForbiddenException('Solo Compras pide cotizaciones.');
    const r = await this.loadRequest(requestId);
    const supplier = supplierId ? await this.suppliers.findOne({ where: { id: supplierId }, relations: ['contacts'] }) : null;
    const contact = supplier?.contacts?.find((c) => c.isDefault) ?? supplier?.contacts?.[0] ?? null;
    return this.renderRfq(r, supplier ?? { name: '' }, contact, await this.sender(user));
  }

  private async renderRfq(r: MaintenanceRequest, supplier: Pick<Supplier, 'name'>, contact: SupplierContact | null,
    sender: { name: string; email: string | null }, notes?: string) {
    const out = await this.templates.render('request_quote_pdf', mapRequestToRfqPdf(r, supplier, contact, sender, notes) as any);
    if (!out.buffer) throw new BadRequestException('No se pudo generar el PDF de la solicitud de cotización.');
    return { buffer: out.buffer, fileName: `Cotizacion-${r.folio}.pdf` };
  }

  /**
   * Manda la solicitud de cotización a cada proveedor elegido por su canal (o el predeterminado del
   * contacto). No se detiene si uno falla: regresa el resultado por proveedor y deja todo en bitácora.
   */
  async sendRfq(requestId: string, dto: SendRfqDto, user: ScopeUser): Promise<RfqResult[]> {
    if (!isPurchaser(user)) throw new ForbiddenException('Solo Compras pide cotizaciones.');
    const r = await this.loadRequest(requestId);
    if (!['abierta', 'en_cotizacion'].includes(r.status)) {
      throw new BadRequestException(r.status === 'por_revisar'
        ? 'Primero autoriza la solicitud para poder pedir cotizaciones.'
        : 'La solicitud ya no está en cotización.');
    }
    const ids = [...new Set(dto.targets.map((t) => t.supplierId))];
    const suppliers = await this.suppliers.find({ where: { id: In(ids) }, relations: ['contacts'] });
    const sender = await this.sender(user);
    const company = (await this.branding.getTokens()).fiscal?.razonSocial || 'PMY';

    const results: RfqResult[] = [];
    for (const t of dto.targets) {
      const supplier = suppliers.find((s) => s.id === t.supplierId);
      if (!supplier) { results.push({ supplierId: t.supplierId, supplierName: 'Proveedor', ok: false, error: 'El proveedor no existe.' }); continue; }
      const contact = t.contactId
        ? supplier.contacts?.find((c) => c.id === t.contactId) ?? null
        : supplier.contacts?.find((c) => c.isDefault) ?? supplier.contacts?.[0] ?? null;
      const channel: ContactChannel = t.channel ?? contact?.preferredChannel ?? 'email';
      let destination = '';
      let emailLogId: string | null = null;
      try {
        if (!contact) throw new BadRequestException(`${supplier.name} no tiene contactos. Agrega uno en Catálogos → Proveedores.`);
        destination = resolveDestination(contact, channel);
        const pdf = await this.renderRfq(r, supplier, contact, sender, dto.notes);
        if (channel === 'email') {
          emailLogId = await this.sendEmail(r, supplier, contact, destination, pdf, user, sender, company, dto.notes);
        } else {
          await this.whatsapp.sendDocument(destination, pdf.buffer, pdf.fileName,
            `Solicitud de cotización ${r.folio} — ${company}. ¿Nos apoya con precio y existencia de lo que viene en el PDF? Gracias.`);
        }
        await this.dispatches.save(this.dispatches.create({
          requestId, supplierId: supplier.id, channel, destination, status: 'enviado', kind: 'rfq', emailLogId,
          sentById: user?.userId ?? null, sentByName: sender.name,
        }));
        results.push({ supplierId: supplier.id, supplierName: supplier.name, ok: true, channel, destination });
      } catch (e: any) {
        const msg = String(e?.response?.message || e?.message || 'Error desconocido');
        await this.dispatches.save(this.dispatches.create({
          requestId, supplierId: supplier.id, channel, destination: destination || '—', status: 'error', kind: 'rfq',
          error: msg.slice(0, 2000), emailLogId, sentById: user?.userId ?? null, sentByName: sender.name,
        }));
        results.push({ supplierId: supplier.id, supplierName: supplier.name, ok: false, channel, destination, error: msg });
      }
    }
    return results;
  }

  private async sendEmail(
    r: MaintenanceRequest, supplier: Supplier, contact: SupplierContact, to: string, pdf: { buffer: Buffer; fileName: string },
    user: ScopeUser, sender: { name: string; email: string | null }, company: string, notes?: string,
  ): Promise<string | null> {
    const subject = `Solicitud de cotización ${r.folio} — ${company}`;
    const html = `
      <div style="font-family:Arial,sans-serif;font-size:14px;color:#1f2937;max-width:560px">
        <p>Hola ${escapeHtml(contact.name)},</p>
        <p>¿Nos puede apoyar con una cotización de los conceptos que vienen en el PDF adjunto (solicitud <b>${escapeHtml(r.folio)}</b>)?</p>
        <p>Por favor indíquenos precio unitario, si incluye IVA/IEPS, si lo tiene en existencia o en cuántos días lo entrega, y la vigencia.</p>
        ${notes?.trim() ? `<p><b>Notas:</b> ${escapeHtml(notes.trim())}</p>` : ''}
        <p>Puede responder a este correo${sender.email ? ` o escribir a ${escapeHtml(sender.email)}` : ''}.</p>
        <p style="margin-top:20px">Gracias,<br/>${escapeHtml(sender.name)}<br/>${escapeHtml(company)}</p>
      </div>`;
    const cc = sender.email || undefined;
    const attachments = [{ filename: pdf.fileName, content: pdf.buffer }];
    const log = async (status: EmailStatus, toAddr: string, ccAddr: string | null, error: string | null, messageId: string | null) => {
      try {
        await this.emailLog.persistAttachments(RFQ_EMAIL_MODULE, r.id, [{ filename: pdf.fileName, content: pdf.buffer, mimeType: 'application/pdf' }]);
        const row = await this.emailLog.record({
          module: RFQ_EMAIL_MODULE, entityId: r.id, emailType: 'solicitud_cotizacion', referenceTracking: `${r.folio} · ${supplier.name}`,
          subsidiaryId: r.subsidiaryId, subsidiaryName: r.subsidiary?.name ?? null, to: toAddr, cc: ccAddr, subject, status, error,
          messageId, triggeredById: user?.userId ?? null, triggeredByName: sender.name,
          attachmentsMeta: [{ filename: pdf.fileName, size: pdf.buffer.length }],
        });
        return row?.id ?? null;
      } catch (e: any) {
        this.logger.warn(`no se pudo registrar la bitácora de correo de ${r.folio}: ${e?.message}`);
        return null;
      }
    };
    try {
      const result = await this.mail.sendPurchaseOrderEmail({ to, cc, subject, html, attachments });
      return log(EmailStatus.SENT, result.to, result.cc, null, result.messageId ?? null);
    } catch (e: any) {
      await log(EmailStatus.ERROR, to, cc ?? null, e?.message ?? 'Error SMTP', null);
      throw e;
    }
  }

  /** PDF del comparativo por partida con lo elegido (o la propuesta). */
  async comparisonPdf(requestId: string, user: ScopeUser) {
    const c = await this.comparison.get(requestId, user); // valida acceso
    if (!c.quotes.length) throw new BadRequestException('Todavía no hay cotizaciones para comparar.');
    const r = await this.loadRequest(requestId);
    const { name } = await this.sender(user);
    const out = await this.templates.render('purchase_comparison_pdf', mapComparisonToPdf(r, c, c.units, name) as any);
    if (!out.buffer) throw new BadRequestException('No se pudo generar el PDF del comparativo.');
    return { buffer: out.buffer, fileName: `Comparativo-${r.folio}.pdf` };
  }
}

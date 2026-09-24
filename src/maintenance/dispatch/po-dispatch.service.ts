import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PurchaseOrder } from 'src/entities/purchase-order.entity';
import { PurchaseOrderDispatch } from 'src/entities/purchase-order-dispatch.entity';
import { ContactChannel, SupplierContact } from 'src/entities/supplier-contact.entity';
import { TemplateService } from 'src/documents/template.service';
import { BrandingService } from 'src/documents/branding.service';
import { MailService } from 'src/mail/mail.service';
import { EmailLogService } from 'src/email-log/email-log.service';
import { WhatsappGatewayService } from 'src/whatsapp-gateway/whatsapp-gateway.service';
import { EmailStatus } from 'src/common/enums/email-status.enum';
import { assertTransition } from '../utils/po-state.util';
import { toWhatsappNumber } from '../utils/whatsapp-number.util';
import { ScopeUser, userDisplayName } from '../maintenance-scope.util';
import { mapPurchaseOrderToPdf } from './po-pdf.mapper';

export const PO_EMAIL_MODULE = 'purchase_order';

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const money = (n: number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n || 0));

/** Resuelve destino según canal: correo del contacto o WhatsApp (whatsapp || teléfono) normalizado a 52+10. */
export function resolveDestination(contact: SupplierContact | null | undefined, channel: ContactChannel): string {
  if (!contact) throw new BadRequestException('La orden no tiene contacto del proveedor. Elige uno antes de enviar.');
  if (channel === 'email') {
    if (!contact.email?.trim()) throw new BadRequestException(`El contacto "${contact.name}" no tiene correo.`);
    return contact.email.trim();
  }
  const n = toWhatsappNumber(contact.whatsapp || contact.phone);
  if (!n) throw new BadRequestException(`El contacto "${contact.name}" no tiene un WhatsApp válido (10 dígitos).`);
  return n;
}

/** PDF de la orden y su envío al proveedor por correo o WhatsApp, con bitácora de intentos. */
@Injectable()
export class PoDispatchService {
  private readonly logger = new Logger(PoDispatchService.name);

  constructor(
    @InjectRepository(PurchaseOrder) private readonly orders: Repository<PurchaseOrder>,
    @InjectRepository(PurchaseOrderDispatch) private readonly dispatches: Repository<PurchaseOrderDispatch>,
    private readonly templates: TemplateService,
    private readonly branding: BrandingService,
    private readonly mail: MailService,
    private readonly emailLog: EmailLogService,
    private readonly whatsapp: WhatsappGatewayService,
  ) {}

  async renderPdf(po: PurchaseOrder): Promise<{ buffer: Buffer; fileName: string }> {
    const r = await this.templates.render('purchase_order_pdf', mapPurchaseOrderToPdf(po) as any);
    if (!r.buffer) throw new BadRequestException('No se pudo generar el PDF de la orden.');
    return { buffer: r.buffer, fileName: `${po.folio}.pdf` };
  }

  history(poId: string) {
    return this.dispatches.find({ where: { purchaseOrderId: poId }, order: { sentAt: 'DESC' } });
  }

  /**
   * Envía la orden AUTORIZADA (o reenvía una ENVIADA) por el canal elegido o el predeterminado del
   * contacto. Solo si el envío sale bien la orden pasa a "enviada"; si falla queda como estaba.
   */
  async send(po: PurchaseOrder, user: ScopeUser, opts: { channel?: ContactChannel; contactId?: string } = {}) {
    if (po.status !== 'autorizada' && po.status !== 'enviada') {
      throw new BadRequestException('Solo se envían órdenes autorizadas.');
    }
    const contact = opts.contactId
      ? po.supplier?.contacts?.find((c) => c.id === opts.contactId) ?? null
      : po.contact ?? po.supplier?.contacts?.find((c) => c.isDefault) ?? null;
    if (opts.contactId && !contact) throw new BadRequestException('El contacto no pertenece al proveedor de la orden.');
    const channel: ContactChannel = opts.channel ?? contact?.preferredChannel ?? 'email';
    const destination = resolveDestination(contact, channel);
    const { buffer, fileName } = await this.renderPdf(po);
    const sentByName = userDisplayName(user);

    let emailLogId: string | null = null;
    try {
      if (channel === 'email') {
        emailLogId = await this.sendEmail(po, contact!, destination, { buffer, fileName }, user, sentByName);
      } else {
        const company = (await this.branding.getTokens()).fiscal?.razonSocial || 'PMY';
        await this.whatsapp.sendDocument(
          destination, buffer, fileName,
          `Orden de compra ${po.folio} — ${company}. Total ${money(po.total)}. Favor de confirmar de recibido.`,
        );
      }
    } catch (e: any) {
      const msg = e?.response?.message || e?.message || 'Error desconocido';
      await this.dispatches.save(this.dispatches.create({
        purchaseOrderId: po.id, channel, destination, status: 'error', kind: 'orden', error: String(msg).slice(0, 2000),
        emailLogId, sentById: user?.userId ?? null, sentByName,
      }));
      const other = channel === 'email' ? 'WhatsApp' : 'correo';
      throw new BadRequestException(`No se pudo enviar por ${channel === 'email' ? 'correo' : 'WhatsApp'}: ${msg}. Puedes intentar por ${other}.`);
    }

    await this.dispatches.save(this.dispatches.create({
      purchaseOrderId: po.id, channel, destination, status: 'enviado', kind: 'orden', emailLogId,
      sentById: user?.userId ?? null, sentByName,
    }));
    assertTransition(po.status, 'enviada');
    await this.orders.update(po.id, { status: 'enviada', contactId: contact?.id ?? po.contactId, updatedAt: new Date() });
    return { channel, destination };
  }

  private async sendEmail(
    po: PurchaseOrder, contact: SupplierContact, to: string, pdf: { buffer: Buffer; fileName: string },
    user: ScopeUser, sentByName: string,
  ): Promise<string | null> {
    const tokens = await this.branding.getTokens();
    const company = tokens.fiscal?.razonSocial || 'PMY';
    const unit = [po.vehicle?.code || po.vehicle?.name, po.vehicle?.plateNumber].filter(Boolean).join(' · ');
    const subject = `Orden de compra ${po.folio} — ${company}`;
    const html = `
      <div style="font-family:Arial,sans-serif;font-size:14px;color:#1f2937;max-width:560px">
        <p>Hola ${escapeHtml(contact.name)},</p>
        <p>Te compartimos la <b>orden de compra ${escapeHtml(po.folio)}</b> autorizada para la unidad <b>${escapeHtml(unit)}</b>.</p>
        <table style="border-collapse:collapse;margin:12px 0">
          <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Sucursal</td><td>${escapeHtml(po.subsidiary?.name ?? '')}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Total</td><td><b>${money(po.total)}</b></td></tr>
        </table>
        <p>El detalle va en el PDF adjunto. Solo se autorizan los conceptos listados; cualquier trabajo adicional requiere una nueva autorización.</p>
        <p>Por favor confirma de recibido respondiendo este correo.</p>
        <p style="margin-top:20px">Saludos,<br/>${escapeHtml(sentByName)}<br/>${escapeHtml(company)}</p>
      </div>`;
    const cc = po.subsidiary?.officeEmail?.trim() || undefined;
    const attachments = [{ filename: pdf.fileName, content: pdf.buffer }];
    try {
      const result = await this.mail.sendPurchaseOrderEmail({ to, cc, subject, html, attachments });
      const log = await this.recordEmail(po, result.to, result.cc, subject, EmailStatus.SENT, null, result.messageId, user, sentByName, pdf);
      return log;
    } catch (e: any) {
      await this.recordEmail(po, to, cc ?? null, subject, EmailStatus.ERROR, e?.message ?? 'Error SMTP', null, user, sentByName, pdf);
      throw e;
    }
  }

  private async recordEmail(
    po: PurchaseOrder, to: string, cc: string | null, subject: string, status: EmailStatus, error: string | null,
    messageId: string | null | undefined, user: ScopeUser, sentByName: string, pdf: { buffer: Buffer; fileName: string },
  ): Promise<string | null> {
    try {
      await this.emailLog.persistAttachments(PO_EMAIL_MODULE, po.id, [{ filename: pdf.fileName, content: pdf.buffer, mimeType: 'application/pdf' }]);
      const log = await this.emailLog.record({
        module: PO_EMAIL_MODULE, entityId: po.id, emailType: 'orden_compra', referenceTracking: po.folio,
        subsidiaryId: po.subsidiaryId, subsidiaryName: po.subsidiary?.name ?? null, to, cc, subject, status, error,
        messageId: messageId ?? null, triggeredById: user?.userId ?? null, triggeredByName: sentByName,
        attachmentsMeta: [{ filename: pdf.fileName, size: pdf.buffer.length }],
      });
      return log?.id ?? null;
    } catch (e: any) {
      this.logger.warn(`no se pudo registrar la bitácora de correo de ${po.folio}: ${e?.message}`);
      return null;
    }
  }

  /** Aviso de cancelación por el mismo canal del último envío exitoso. Nunca lanza. */
  async sendCancellation(po: PurchaseOrder, reason: string, user: ScopeUser): Promise<void> {
    const last = (await this.history(po.id)).find((d) => d.status === 'enviado' && d.kind === 'orden');
    if (!last) return;
    const text = `La orden de compra ${po.folio} queda CANCELADA. Motivo: ${reason}. Por favor no realices el servicio.`;
    const sentByName = userDisplayName(user);
    try {
      if (last.channel === 'email') {
        await this.mail.sendPurchaseOrderEmail({
          to: last.destination, subject: `CANCELADA: orden de compra ${po.folio}`,
          html: `<p style="font-family:Arial,sans-serif">${escapeHtml(text)}</p><p style="font-family:Arial,sans-serif">${escapeHtml(sentByName)}</p>`,
        });
      } else {
        await this.whatsapp.sendText(last.destination, text);
      }
      await this.dispatches.save(this.dispatches.create({
        purchaseOrderId: po.id, channel: last.channel, destination: last.destination, status: 'enviado', kind: 'cancelacion',
        sentById: user?.userId ?? null, sentByName,
      }));
    } catch (e: any) {
      await this.dispatches.save(this.dispatches.create({
        purchaseOrderId: po.id, channel: last.channel, destination: last.destination, status: 'error', kind: 'cancelacion',
        error: String(e?.message ?? e).slice(0, 2000), sentById: user?.userId ?? null, sentByName,
      }));
    }
  }
}

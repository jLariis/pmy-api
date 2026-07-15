import { Injectable } from '@nestjs/common';
import { BrandingService } from './branding.service';
import { RenderResult } from './documents.types';

/** Renderer de último recurso: garantiza que el documento SIEMPRE se emita. */
@Injectable()
export class FallbackRenderer {
  constructor(private readonly branding: BrandingService) {}

  async render(code: string, data: Record<string, any>): Promise<RenderResult> {
    const brand = await this.branding.getTokens();
    const subject = data?.subject ?? data?.title ?? 'Notificación PMY';
    const body = data?.body ?? 'Se generó un documento en el sistema.';
    const html = `
      <div style="font-family:${brand.typography.fontFamily};color:${brand.colors.text};max-width:600px;margin:0 auto">
        <h2 style="border-bottom:3px solid ${brand.colors.primary};padding-bottom:8px">${this.escapeHtml(subject)}</h2>
        <p>${this.escapeHtml(body)}</p>
        <hr style="margin:24px 0;border:none;border-top:1px solid #eee" />
        <p style="font-size:0.85em;color:#7f8c8d">Documento generado automáticamente (plantilla '${this.escapeHtml(code)}' no disponible).</p>
      </div>`;
    return { format: 'email', mime: 'text/html', subject, html };
  }

  private escapeHtml(s: string): string {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

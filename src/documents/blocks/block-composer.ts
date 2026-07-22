import { Injectable } from '@nestjs/common';
import { EmailBlock, EmailDoc } from './email-doc.types';

/**
 * Convierte un EmailDoc (bloques) en MJML. NO interpola: deja intactos los
 * placeholders {{var}} y {{brand.*}} (los resuelve el TemplateEngine después).
 * El frame branded es idéntico al del seed de Fase 1 (header razón social + footer).
 */
@Injectable()
export class BlockComposer {
  compose(doc: EmailDoc): string {
    const inner = (doc?.blocks ?? []).map((b) => this.renderBlock(b)).join('\n');
    return `<mjml><mj-body background-color="#f4f4f4" width="800px">
  <mj-section background-color="#ffffff"><mj-column>
    <mj-text font-size="18px" font-weight="bold" color="{{brand.colors.secondary}}">{{brand.fiscal.razonSocial}}</mj-text>
${inner}
    <mj-divider border-color="#eeeeee" />
    <mj-text font-size="12px" color="#7f8c8d">Este correo fue enviado automáticamente por el sistema. Por favor, no responda a este mensaje.<br/>{{brand.contact.website}}</mj-text>
  </mj-column></mj-section>
</mj-body></mjml>`;
  }

  private renderBlock(b: EmailBlock): string {
    const mjml = this.blockToMjml(b);
    return b.when ? `{{#if ${b.when}}}${mjml}{{/if}}` : mjml;
  }

  private blockToMjml(b: EmailBlock): string {
    switch (b.type) {
      case 'heading':
        return `<mj-text font-size="16px" font-weight="bold" color="{{brand.colors.primary}}">${b.text}</mj-text>`;
      case 'paragraph':
        return `<mj-text>${b.text}</mj-text>`;
      case 'button':
        return `<mj-button href="${b.url}" background-color="{{brand.colors.button}}">${b.text}</mj-button>`;
      case 'image':
        return `<mj-image src="${b.src}"${b.alt ? ` alt="${b.alt}"` : ''}${b.width ? ` width="${b.width}px"` : ''} />`;
      case 'divider':
        return `<mj-divider border-color="#eeeeee" />`;
      case 'spacer':
        return `<mj-spacer height="${b.size}px" />`;
      case 'keyValue':
        return `<mj-text>${b.items.map((i) => `<b>${i.label}:</b> ${i.value}`).join('<br/>')}</mj-text>`;
      case 'table': {
        const head = b.columns.map((c) => `<th style="text-align:left;border-bottom:1px solid #ddd;padding:6px">${c.label}</th>`).join('');
        const cells = b.columns.map((c) => `<td style="padding:6px">{{this.${c.key}}}</td>`).join('');
        return `<mj-table><tr>${head}</tr>{{#each ${b.rowsVar}}}<tr>${cells}</tr>{{/each}}</mj-table>`;
      }
      case 'raw':
        return `<mj-raw>${b.html}</mj-raw>`;
      default:
        return '';
    }
  }
}

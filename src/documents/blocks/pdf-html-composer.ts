import { Injectable } from '@nestjs/common';
import { PdfBlock, PdfDoc } from './pdf-doc.types';

/**
 * Convierte un PdfDoc en HTML branded. NO interpola: deja {{var}}/{{brand.*}}
 * intactos (los resuelve el TemplateEngine antes de Chromium). Estilos usan
 * tokens de marca vía placeholders.
 */
@Injectable()
export class PdfHtmlComposer {
  compose(doc: PdfDoc): string {
    const margins = doc.page.margins ?? '20px';
    const header = doc.header
      ? `<div class="doc-header"><div class="doc-title">${doc.header.title}</div>${doc.header.showDateTime ? `<div class="doc-datetime">{{system.now}}</div>` : ''}</div>`
      : '';
    const body = (doc.blocks ?? []).map((b) => this.block(b)).join('\n');
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      @page { size: ${doc.page.size} ${doc.page.orientation}; margin: ${margins}; }
      * { box-sizing: border-box; font-family: {{brand.typography.fontFamily}}; }
      body { color: {{brand.colors.text}}; font-size: 11px; margin: 0; }
      .doc-header { display:flex; justify-content:space-between; align-items:center; border-bottom:3px solid {{brand.colors.primary}}; padding-bottom:6px; margin-bottom:8px; }
      .doc-title { font-size:18px; font-weight:bold; color:{{brand.colors.secondary}}; }
      .doc-datetime { font-size:11px; color:#555; text-align:right; white-space:pre-line; }
      .info-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:6px; margin:8px 0; }
      .info-cell { background:#f8f9fa; padding:6px; border-radius:4px; }
      .info-cell .k { font-size:9px; color:#777; } .info-cell .v { font-weight:bold; }
      .symbology { font-size:10px; color:#555; margin:6px 0; }
      table { width:100%; border-collapse:collapse; margin-top:6px; }
      th { background:{{brand.colors.primary}}; color:#fff; padding:5px; font-size:10px; text-align:left; }
      td { padding:4px 5px; border-bottom:0.5px solid #ccc; font-size:10px; }
      tr.pago td { background:#fff2cc; } tr.vencehoy td { background:#ffe6e6; }
      .stat-boxes { display:flex; gap:8px; margin:8px 0; } .stat-box { flex:1; background:#f8f9fa; border-radius:6px; padding:8px; text-align:center; }
      .signatures { display:flex; gap:24px; margin-top:28px; } .sig { flex:1; border-top:1px solid #333; padding-top:4px; font-size:10px; text-align:center; }
      .doc-footer { margin-top:16px; font-size:9px; color:#7f8c8d; }
    </style></head><body>
${header}
${body}
</body></html>`;
  }

  private block(b: PdfBlock): string {
    switch (b.type) {
      case 'heading': return `<h2 style="color:{{brand.colors.primary}}">${b.text}</h2>`;
      case 'paragraph': return `<p>${b.text}</p>`;
      case 'symbology': return `<div class="symbology">${b.text}</div>`;
      case 'infoGrid':
        return `<div class="info-grid">${b.cells.map((c) => `<div class="info-cell"><div class="k">${c.label}</div><div class="v">${c.value}</div></div>`).join('')}</div>`;
      case 'statBoxes':
        return `<div class="stat-boxes">${b.boxes.map((x) => `<div class="stat-box"><div class="v" style="font-size:18px;font-weight:bold">${x.value}</div><div class="k" style="font-size:9px;color:#777">${x.label}</div></div>`).join('')}</div>`;
      case 'table': {
        const th = b.columns.map((c) => {
          const styles = [c.width ? `width:${c.width}px` : null, c.align ? `text-align:${c.align}` : null].filter(Boolean).join(';');
          return this.wrapCol(c, `<th${styles ? ` style="${styles}"` : ''}>${c.label}</th>`);
        }).join('');
        const td = b.columns.map((c) => this.wrapCol(c, `<td${c.align ? ` style="text-align:${c.align}"` : ''}>{{this.${c.key}}}</td>`)).join('');
        const cls = b.rowClassVar ? ` class="{{this.${b.rowClassVar}}}"` : '';
        return `<table><thead><tr>${th}</tr></thead><tbody>{{#each ${b.rowsVar}}}<tr${cls}>${td}</tr>{{/each}}</tbody></table>`;
      }
      case 'signatures':
        return `<div class="signatures">${b.slots.map((s) => `<div class="sig">${s.label}</div>`).join('')}</div>`;
      case 'footer': return `<div class="doc-footer">${b.text}</div>`;
      default: return '';
    }
  }

  /** Columna condicional: {{#unless <hideWhen>}} … {{/unless}}. */
  private wrapCol(c: { hideWhen?: string }, html: string): string {
    return c.hideWhen ? `{{#unless ${c.hideWhen}}}${html}{{/unless}}` : html;
  }
}

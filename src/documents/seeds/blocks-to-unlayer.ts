import { EmailBlock } from '../blocks/email-doc.types';

/**
 * Convierte un arreglo de EmailBlock (nuestro formato de bloques) en un diseño
 * Unlayer mínimo válido, para que el editor (que sólo entiende el formato de
 * Unlayer) pueda abrir y mostrar el contenido real de la plantilla.
 *
 * Cada bloque se mapea a EXACTAMENTE una fila (row) de una sola columna.
 * No interpola: los placeholders {{var}} / {{{var}}} quedan intactos, los
 * resuelve el TemplateEngine al momento de renderizar (a partir de
 * `compiledBody`, no de este `designJson`).
 */
export function blocksToUnlayerDesign(blocks: EmailBlock[]): any {
  const rows = (blocks ?? []).map((b) => blockToRow(b));
  return {
    body: {
      id: 'body',
      rows,
      values: {},
    },
  };
}

function blockToRow(b: EmailBlock): any {
  return {
    cells: [1],
    columns: [
      {
        contents: [blockToContent(b)],
        values: {},
      },
    ],
    values: {},
  };
}

function blockToContent(b: EmailBlock): any {
  switch (b.type) {
    case 'heading':
      return { type: 'text', values: { text: `<h2>${b.text}</h2>` } };
    case 'paragraph':
      return { type: 'text', values: { text: `<p>${b.text}</p>` } };
    case 'keyValue':
      return {
        type: 'text',
        values: { text: b.items.map((i) => `<b>${i.label}:</b> ${i.value}`).join('<br/>') },
      };
    case 'button':
      return {
        type: 'button',
        values: { text: b.text, href: { name: 'web', values: { href: b.url, target: '_blank' } } },
      };
    case 'image':
      return {
        type: 'image',
        values: { src: { url: b.src || '', width: b.width, ...(b.alt ? { alt: b.alt } : {}) } },
      };
    case 'divider':
      return { type: 'divider', values: {} };
    case 'spacer':
      return { type: 'html', values: { html: `<div style="height:${b.size || 16}px"></div>` } };
    case 'table': {
      const head = b.columns
        .map((c) => `<th style="text-align:left;border-bottom:1px solid #ddd;padding:6px">${c.label}</th>`)
        .join('');
      const cells = b.columns.map((c) => `<td style="padding:6px">{{this.${c.key}}}</td>`).join('');
      return {
        type: 'html',
        values: {
          html:
            '<table style="width:100%;border-collapse:collapse">' +
            `<tr>${head}</tr>` +
            `{{#each ${b.rowsVar}}}<tr>${cells}</tr>{{/each}}` +
            '</table>',
        },
      };
    }
    case 'raw':
      return { type: 'html', values: { html: b.html } };
    default:
      return { type: 'html', values: { html: '' } };
  }
}

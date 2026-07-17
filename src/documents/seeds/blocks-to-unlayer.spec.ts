import { blocksToUnlayerDesign } from './blocks-to-unlayer';
import { EmailBlock } from '../blocks/email-doc.types';

function isUnlayerDesign(design: any): boolean {
  return !!design && !!design.body && Array.isArray(design.body.rows);
}

describe('blocksToUnlayerDesign', () => {
  it('devuelve un diseño Unlayer válido con una fila por bloque', () => {
    const blocks: EmailBlock[] = [
      { id: 'h', type: 'heading', text: 'Hola' },
      { id: 'p', type: 'paragraph', text: 'Cuerpo' },
    ];
    const design = blocksToUnlayerDesign(blocks);
    expect(isUnlayerDesign(design)).toBe(true);
    expect(design.body.rows.length).toBe(blocks.length);
  });

  it('preserva los tokens {{var}} en un paragraph', () => {
    const blocks: EmailBlock[] = [
      { id: 'p', type: 'paragraph', text: 'Hola {{subsidiaryName}}, bienvenido' },
    ];
    const design = blocksToUnlayerDesign(blocks);
    const content = design.body.rows[0].columns[0].contents[0];
    expect(content.type).toBe('text');
    expect(content.values.text).toContain('{{subsidiaryName}}');
  });

  it('un button conserva su href y target', () => {
    const blocks: EmailBlock[] = [
      { id: 'b', type: 'button', text: 'Restablecer contraseña', url: '{{resetLink}}' },
    ];
    const design = blocksToUnlayerDesign(blocks);
    const content = design.body.rows[0].columns[0].contents[0];
    expect(content.type).toBe('button');
    expect(content.values.text).toBe('Restablecer contraseña');
    expect(content.values.href.values.href).toBe('{{resetLink}}');
    expect(content.values.href.values.target).toBe('_blank');
  });

  it('mapea keyValue a un content de texto con los pares label:value', () => {
    const blocks: EmailBlock[] = [
      { id: 'kv', type: 'keyValue', items: [
        { label: 'Fecha', value: '{{formatDate createdAt}}' },
        { label: 'Sucursal', value: '{{subsidiaryName}}' },
      ] },
    ];
    const design = blocksToUnlayerDesign(blocks);
    const content = design.body.rows[0].columns[0].contents[0];
    expect(content.type).toBe('text');
    expect(content.values.text).toContain('<b>Fecha:</b> {{formatDate createdAt}}');
    expect(content.values.text).toContain('<b>Sucursal:</b> {{subsidiaryName}}');
  });

  it('mapea image, divider, spacer y raw a sus tipos Unlayer', () => {
    const blocks: EmailBlock[] = [
      { id: 'i', type: 'image', src: 'https://x/y.png', alt: 'logo' },
      { id: 'd', type: 'divider' },
      { id: 's', type: 'spacer', size: 24 },
      { id: 'r', type: 'raw', html: '{{{tableHtml}}}' },
    ];
    const design = blocksToUnlayerDesign(blocks);
    const [imgContent, dividerContent, spacerContent, rawContent] = design.body.rows.map(
      (r: any) => r.columns[0].contents[0],
    );
    expect(imgContent.type).toBe('image');
    expect(imgContent.values.src.url).toBe('https://x/y.png');
    expect(dividerContent.type).toBe('divider');
    expect(spacerContent.type).toBe('html');
    expect(spacerContent.values.html).toContain('height:24px');
    expect(rawContent.type).toBe('html');
    expect(rawContent.values.html).toBe('{{{tableHtml}}}');
  });

  it('mapea table a un content html con el {{#each rowsVar}}', () => {
    const blocks: EmailBlock[] = [
      { id: 't', type: 'table', rowsVar: 'rows', columns: [
        { label: 'Tracking', key: 'trackingNumber' },
        { label: 'Nombre', key: 'recipientName' },
      ] },
    ];
    const design = blocksToUnlayerDesign(blocks);
    const content = design.body.rows[0].columns[0].contents[0];
    expect(content.type).toBe('html');
    expect(content.values.html).toContain('{{#each rows}}');
    expect(content.values.html).toContain('{{this.trackingNumber}}');
    expect(content.values.html).toContain('{{/each}}');
  });

  it('cada fila tiene una sola celda y una sola columna', () => {
    const blocks: EmailBlock[] = [{ id: 'h', type: 'heading', text: 'Hola' }];
    const design = blocksToUnlayerDesign(blocks);
    const row = design.body.rows[0];
    expect(row.cells).toEqual([1]);
    expect(row.columns.length).toBe(1);
    expect(row.columns[0].contents.length).toBe(1);
  });
});

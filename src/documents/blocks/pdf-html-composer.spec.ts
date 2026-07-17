import { PdfHtmlComposer } from './pdf-html-composer';
import { PdfDoc } from './pdf-doc.types';

const composer = new PdfHtmlComposer();

describe('PdfHtmlComposer.compose', () => {
  it('emite documento HTML con orientación y placeholders de marca', () => {
    const doc: PdfDoc = { page: { size: 'LETTER', orientation: 'landscape' }, blocks: [] };
    const html = composer.compose(doc);
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('@page { size: LETTER landscape');
    expect(html).toContain('{{brand.colors.primary}}'); // usa marca en estilos
  });

  it('header con título y fecha/hora', () => {
    const html = composer.compose({ page: { size: 'LETTER', orientation: 'landscape' }, header: { title: '{{title}}', showDateTime: true }, blocks: [] });
    expect(html).toContain('{{title}}');
    expect(html).toContain('{{system.now}}'); // marcador de fecha/hora
  });

  it('infoGrid emite celdas etiqueta/valor con placeholders', () => {
    const html = composer.compose({ page: { size: 'LETTER', orientation: 'landscape' }, blocks: [
      { type: 'infoGrid', cells: [{ label: 'SUCURSAL', value: '{{subsidiaryName}}' }] },
    ] });
    expect(html).toContain('SUCURSAL');
    expect(html).toContain('{{subsidiaryName}}');
  });

  it('table emite cabecera + each, oculta columna con hideWhen, aplica clase por fila', () => {
    const html = composer.compose({ page: { size: 'LETTER', orientation: 'landscape' }, blocks: [
      { type: 'table', rowsVar: 'rows', rowClassVar: 'rowClass', columns: [
        { label: 'NO. GUIA', key: 'trackingNumber' },
        { label: 'HORA', key: 'time', hideWhen: 'isHermosillo' },
      ] },
    ] });
    expect(html).toContain('{{#each rows}}');
    expect(html).toContain('{{this.trackingNumber}}');
    expect(html).toContain('class="{{this.rowClass}}"');
    expect(html).toContain('{{#unless isHermosillo}}'); // columna condicional
  });

  it('symbology y footer', () => {
    const html = composer.compose({ page: { size: 'LETTER', orientation: 'landscape' }, blocks: [
      { type: 'symbology', text: '[C] CARGA' }, { type: 'footer', text: 'pie {{system.env}}' },
    ] });
    expect(html).toContain('[C] CARGA');
    expect(html).toContain('pie {{system.env}}');
  });
});

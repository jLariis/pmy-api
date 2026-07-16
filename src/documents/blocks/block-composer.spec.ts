import { BlockComposer } from './block-composer';
import { EmailDoc } from './email-doc.types';

const composer = new BlockComposer();

describe('BlockComposer.compose', () => {
  it('envuelve en frame MJML branded', () => {
    const mjml = composer.compose({ blocks: [] });
    expect(mjml.startsWith('<mjml')).toBe(true);
    expect(mjml).toContain('{{brand.fiscal.razonSocial}}');       // header del frame
    expect(mjml).toContain('{{brand.contact.website}}');          // footer del frame
  });

  it('heading y paragraph conservan placeholders', () => {
    const doc: EmailDoc = { blocks: [
      { id: '1', type: 'heading', text: '🚚 {{subsidiaryName}}' },
      { id: '2', type: 'paragraph', text: 'Unidad <b>{{vehicleName}}</b>' },
    ] };
    const mjml = composer.compose(doc);
    expect(mjml).toContain('{{subsidiaryName}}');
    expect(mjml).toContain('Unidad <b>{{vehicleName}}</b>');
    expect(mjml).toContain('color="{{brand.colors.primary}}"'); // heading usa color de marca
  });

  it('button usa color de marca y su url', () => {
    const mjml = composer.compose({ blocks: [{ id: 'b', type: 'button', text: 'Abrir', url: '{{resetLink}}' }] });
    expect(mjml).toContain('href="{{resetLink}}"');
    expect(mjml).toContain('background-color="{{brand.colors.button}}"');
    expect(mjml).toContain('Abrir');
  });

  it('table emite cabecera + each sobre rowsVar', () => {
    const mjml = composer.compose({ blocks: [{ id: 't', type: 'table', rowsVar: 'rows',
      columns: [{ label: 'Tracking', key: 'trackingNumber' }, { label: 'Nombre', key: 'recipientName' }] }] });
    expect(mjml).toContain('{{#each rows}}');
    expect(mjml).toContain('{{this.trackingNumber}}');
    expect(mjml).toContain('Tracking');
    expect(mjml).toContain('{{/each}}');
  });

  it('raw envuelve html sin escapar en mj-raw', () => {
    const mjml = composer.compose({ blocks: [{ id: 'r', type: 'raw', html: '{{{tableHtml}}}' }] });
    expect(mjml).toContain('<mj-raw>{{{tableHtml}}}</mj-raw>');
  });

  it('when envuelve el bloque en {{#if}}', () => {
    const mjml = composer.compose({ blocks: [{ id: 'b', type: 'button', text: 'X', url: '{{link}}', when: 'link' }] });
    expect(mjml).toContain('{{#if link}}');
    expect(mjml).toContain('{{/if}}');
  });

  it('ignora (cadena vacía) un tipo de bloque desconocido sin romper', () => {
    const mjml = composer.compose({ blocks: [
      { id: 'x', type: 'no-existe' as any },
      { id: 'h', type: 'heading', text: 'OK' },
    ] });
    expect(mjml).toContain('OK');           // el bloque válido sigue
    expect(mjml).not.toContain('undefined'); // el desconocido no emite "undefined"
    // Verificar que blockToMjml retorna cadena vacía (no undefined)
    const blockComposer = composer as any;
    expect(blockComposer.blockToMjml({ id: 'x', type: 'unknown' as any })).toBe('');
  });
});

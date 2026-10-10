import { analyzeMail, carrierOfSender, decideCarrier, isAllowedSender, mergeConsolidations, quotedSenders, sanitizeMailHtml } from './mail-analysis';
import { CABO, CABORCA } from './__fixtures__/emails';

function rfc822(e: { subject: string; from: string; cc: string[]; body: string; attachments: string[] }): Buffer {
  const b = 'BOUNDARY42';
  const parts = [
    `From: Agente <${e.from}>`,
    `To: sistemas@paqueteriaymensajeriadelyaqui.com`,
    `Cc: ${e.cc.join(', ')}`,
    `Subject: ${e.subject}`,
    `Message-ID: <${e.subject.replace(/\W/g, '')}@fedex.com>`,
    `Date: Thu, 01 Oct 2026 19:32:00 -0700`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${b}"`,
    ``,
    `--${b}`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    e.body,
    ...e.attachments.flatMap((f) => [
      `--${b}`,
      `Content-Type: application/octet-stream; name="${f}"`,
      `Content-Disposition: attachment; filename="${f}"`,
      `Content-Transfer-Encoding: base64`,
      ``,
      Buffer.from('no es un excel real').toString('base64'),
    ]),
    `--${b}--`,
    ``,
  ];
  return Buffer.from(parts.join('\r\n'));
}

describe('mail-analysis', () => {
  it('dominios permitidos incluyen subdominios', () => {
    expect(isAllowedSender('wendy@fedex.com', ['fedex.com'])).toBe(true);
    expect(isAllowedSender('sa_hmoa-noga@corp.ds.fedex.com', ['fedex.com'])).toBe(true);
    expect(isAllowedSender('alguien@notfedex.com', ['fedex.com'])).toBe(false);
    expect(isAllowedSender('pmyapp@paqueteriaymensajeriadelyaqui.com', ['fedex.com'])).toBe(false);
  });

  it('paquetería del correo por dominio del remitente (FedEx / DHL)', () => {
    const domains = { fedex: ['fedex.com'], dhl: ['dhl.com'] };
    expect(carrierOfSender('jose.gaxiola@fedex.com', domains)).toBe('fedex');
    expect(carrierOfSender('sa_hmoa@corp.ds.fedex.com', domains)).toBe('fedex');
    expect(carrierOfSender('developer-support@dhl.com', domains)).toBe('dhl');
    expect(carrierOfSender('ops@mx.dhl.com', domains)).toBe('dhl');
    expect(carrierOfSender('alguien@notdhl.com', domains)).toBeNull();
    expect(carrierOfSender('pmyapp@paqueteriaymensajeriadelyaqui.com', domains)).toBeNull();
  });

  it('reenvío: toma el remitente original de las líneas De:/From: del historial', () => {
    const text = [
      'Buenas tardes',
      '________________________________',
      'De: ELMA LILIA VAZQUEZ ZAMARRON (DHL MX) <elma.vazquez@dhl.com>',
      'Enviado: martes, 26 de mayo de 2026 16:19',
      'Para: paqueteriaymensajeriadelyaqui@hotmail.com',
      'From: Otro <ops@fedex.com>',
    ].join('\n');
    expect(quotedSenders(text)).toEqual(['elma.vazquez@dhl.com', 'ops@fedex.com']);
    expect(quotedSenders('Para: x@dhl.com\nCC: y@dhl.com')).toEqual([]); // solo De:/From:, no Para/CC
    expect(quotedSenders('De: ELMA &lt;elma.vazquez@dhl.com&gt;')).toEqual(['elma.vazquez@dhl.com']); // HTML escapado
  });

  it('paquetería del correo: remitente directo o reenvío de DHL (solo si está permitido)', () => {
    const domains = { fedex: ['fedex.com'], dhl: ['dhl.com'] };
    const fwd = { fromAddress: 'paqueteriaymensajeriadelyaqui@hotmail.com', forwardedFrom: ['elma.vazquez@dhl.com'] };
    expect(decideCarrier(fwd, domains, true)).toBe('dhl');
    expect(decideCarrier(fwd, domains, false)).toBeNull(); // apagado: solo dominio DHL
    expect(decideCarrier({ fromAddress: 'ops@dhl.com', forwardedFrom: [] }, domains, false)).toBe('dhl');
    expect(decideCarrier({ fromAddress: 'a@fedex.com', forwardedFrom: ['b@dhl.com'] }, domains, true)).toBe('fedex'); // el directo manda
    expect(decideCarrier({ fromAddress: 'x@hotmail.com', forwardedFrom: ['b@fedex.com'] }, domains, true)).toBeNull(); // reenvío FedEx no cambia nada
  });

  it('analiza el correo de Cabo: encabezados, consolidados, cobros y adjuntos', async () => {
    const m = await analyzeMail(rfc822(CABO));
    expect(m.fromAddress).toBe('jose.gaxiola@fedex.com');
    expect(m.cc).toContain('loscabosteam@fedex.com');
    expect(m.subject).toBe('CARGA YAQUI CABO 10/01/26');
    expect(m.consolidations.map((c) => `${c.kind}:${c.consNumber}`)).toEqual(['master:305821242296', 'f2:305821512729']);
    expect(m.cobros).toHaveLength(11);
    expect(m.attachments.map((a) => a.kind)).toEqual(['master', 'ccp_ignored']);
    expect(m.attachments[0].consNumber).toBe('305821242296');
    expect(m.attachments[0].sha256).toHaveLength(64);
  });

  it('PREALERTA con historial: solo el consolidado nuevo', async () => {
    const m = await analyzeMail(rfc822(CABORCA));
    expect(m.hadHistory).toBe(true);
    expect(m.consolidations.map((c) => c.consNumber)).toEqual(['818861721255']);
    expect(m.attachments.map((a) => a.kind)).toEqual(['master', 'pdf']);
  });

  it('agrega consolidados de nombres de archivo aéreo/valor', () => {
    expect(
      mergeConsolidations([], [
        { kind: 'master_aereo', consNumber: '305821000001' },
        { kind: 'ccp_ignored', consNumber: '305821000002' },
      ]),
    ).toEqual([{ consNumber: '305821000001', kind: 'aereo', announcedCount: null }]);
  });

  it('sanitiza HTML: sin scripts ni imágenes', () => {
    const h = sanitizeMailHtml('<p>Hola</p><script>alert(1)</script><img src="http://x/y.png"><table><tr><td>1</td></tr></table>');
    expect(h).toContain('<p>Hola</p>');
    expect(h).not.toMatch(/script|img/);
    expect(h).toContain('<td>1</td>');
  });
});

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { RequestDispatchService } from './request-dispatch.service';

const gerardo = { userId: 'g1', role: 'admin', permissions: ['mttoVehiculos.revisar'] };

function make(opts: { status?: string; whatsappFails?: boolean } = {}) {
  const saved: any[] = [];
  const request = { id: 'r1', folio: 'SOL-000001', type: 'compra', status: opts.status ?? 'en_cotizacion', subsidiaryId: 's1', subsidiary: { name: 'HMO' }, items: [] };
  const requests: any = { findOne: jest.fn(async () => request) };
  const dispatches: any = { create: (x: any) => x, save: jest.fn(async (x: any) => saved.push(x)) };
  const suppliers: any = {
    find: jest.fn(async () => [
      { id: 'sA', name: 'AutoZone', contacts: [{ id: 'cA', name: 'Ana', email: 'ana@az.com', preferredChannel: 'email', isDefault: true }] },
      { id: 'sB', name: 'Orealli', contacts: [{ id: 'cB', name: 'Beto', whatsapp: '662 111 2233', preferredChannel: 'whatsapp', isDefault: true }] },
      { id: 'sC', name: 'Sin contacto', contacts: [] },
    ]),
  };
  const users: any = { findOne: jest.fn(async () => ({ id: 'g1', name: 'Gerardo', lastName: 'Robles', email: 'g@pmy.mx' })) };
  const templates: any = { render: jest.fn(async () => ({ buffer: Buffer.from('%PDF') })) };
  const branding: any = { getTokens: jest.fn(async () => ({ fiscal: { razonSocial: 'PMY' } })) };
  const mail: any = { sendPurchaseOrderEmail: jest.fn(async (o: any) => ({ to: o.to, cc: o.cc, messageId: 'm1' })) };
  const emailLog: any = { persistAttachments: jest.fn(), record: jest.fn(async () => ({ id: 'log1' })) };
  const whatsapp: any = { sendDocument: jest.fn(async () => { if (opts.whatsappFails) throw new Error('WhatsApp desconectado'); }) };
  const svc = new RequestDispatchService(requests, dispatches, suppliers, users, {} as any, templates, branding, mail, emailLog, whatsapp);
  return { svc, saved, mail, whatsapp };
}

describe('RequestDispatchService.sendRfq', () => {
  it('manda a cada proveedor por su canal y sigue aunque uno falle', async () => {
    const { svc, saved, mail, whatsapp } = make();
    const out = await svc.sendRfq('r1', { targets: [{ supplierId: 'sA' }, { supplierId: 'sB' }, { supplierId: 'sC' }] }, gerardo);
    expect(out.map((r) => [r.supplierName, r.ok])).toEqual([['AutoZone', true], ['Orealli', true], ['Sin contacto', false]]);
    expect(mail.sendPurchaseOrderEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'ana@az.com', cc: 'g@pmy.mx' }));
    expect(whatsapp.sendDocument).toHaveBeenCalledWith('526621112233', expect.any(Buffer), 'Cotizacion-SOL-000001.pdf', expect.stringContaining('SOL-000001'));
    expect(out[2].error).toMatch(/no tiene contactos/);
    expect(saved.map((d) => d.status)).toEqual(['enviado', 'enviado', 'error']);
    expect(saved[0]).toMatchObject({ kind: 'rfq', emailLogId: 'log1', sentByName: 'Gerardo Robles' });
  });

  it('registra el error del canal', async () => {
    const { svc, saved } = make({ whatsappFails: true });
    const [r] = await svc.sendRfq('r1', { targets: [{ supplierId: 'sB' }] }, gerardo);
    expect(r).toMatchObject({ ok: false, error: 'WhatsApp desconectado' });
    expect(saved[0]).toMatchObject({ status: 'error', destination: '526621112233' });
  });

  it('solo Compras y con la solicitud autorizada', async () => {
    await expect(make().svc.sendRfq('r1', { targets: [{ supplierId: 'sA' }] }, { userId: 'x', permissions: [] })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(make({ status: 'por_revisar' }).svc.sendRfq('r1', { targets: [{ supplierId: 'sA' }] }, gerardo)).rejects.toThrow(/autoriza la solicitud/);
    await expect(make({ status: 'completada' }).svc.sendRfq('r1', { targets: [{ supplierId: 'sA' }] }, gerardo)).rejects.toBeInstanceOf(BadRequestException);
  });
});

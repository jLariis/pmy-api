import { MailService } from './mail.service';

function make() {
  const mailer: any = { sendMail: jest.fn(() => Promise.resolve()) };
  const config: any = { get: () => 'production' };
  const templates: any = { render: jest.fn(() => Promise.resolve({ subject: 'Salida a ruta - Juan', html: '<p>ok</p>' })) };
  const svc = new MailService(mailer, config, templates);
  return { svc, mailer, templates };
}

describe('MailService.sendHighPriorityPackageDispatchEmail', () => {
  it('renderiza el correo por plantilla route_dispatch y lo envía', async () => {
    const { svc, mailer, templates } = make();
    const pd: any = { vehicle: { name: 'V1' }, drivers: [{ name: 'Juan' }], routes: [{ name: 'R1' }], trackingNumber: 'T1', createdAt: new Date(), subsidiary: { officeEmail: 'a@x.com', officeEmailToCopy: 'b@x.com' } };
    const pdf: any = { originalname: 'r.pdf', buffer: Buffer.from('x') };
    const xls: any = { originalname: 'r.xlsx', buffer: Buffer.from('y') };
    await svc.sendHighPriorityPackageDispatchEmail(pdf, xls, 'Sucursal X', pd);
    expect(templates.render).toHaveBeenCalledWith('route_dispatch', expect.objectContaining({ subsidiaryName: 'Sucursal X', trackingNumber: 'T1' }));
    expect(mailer.sendMail).toHaveBeenCalled();
    const arg = mailer.sendMail.mock.calls[0][0];
    expect(arg.html).toContain('ok');
    expect(arg.attachments).toHaveLength(2);
  });
});

describe('MailService — detailLink', () => {
  const OLD = process.env.FRONTEND_URL;
  beforeAll(() => { process.env.FRONTEND_URL = 'https://app.example.com/'; });
  afterAll(() => { process.env.FRONTEND_URL = OLD; });

  it('desembarque manda detailLink a /operaciones/desembarques con seguimiento', async () => {
    const { svc, templates } = make();
    const unloading: any = {
      subsidiary: { officeEmail: 'a@b.com', officeEmailToCopy: 'c@d.com' },
      vehicle: { name: 'U1' }, createdAt: new Date(), trackingNumber: 'ABC123',
    };
    const file: any = { originalname: 'a.pdf', buffer: Buffer.from('') };
    await svc.sendHighPriorityUnloadingEmail(file, file, 'SUC', unloading);
    const data = (templates.render as jest.Mock).mock.calls[0][1];
    expect(data.detailLink).toBe('https://app.example.com/operaciones/desembarques?seguimiento=ABC123');
  });

  it('cierre de ruta manda trackingNumber y detailLink a salidas-a-ruta', async () => {
    const { svc, templates } = make();
    const rc: any = {
      subsidiary: { name: 'SUC', officeEmail: 'a@b.com', officeEmailToCopy: 'c@d.com' },
      packageDispatch: { drivers: [{ name: 'Juan' }], trackingNumber: 'RC9' },
    };
    const file: any = { originalname: 'a.pdf', buffer: Buffer.from('') };
    await svc.sendHighPriorityRouteClosureEmail(file, file, rc);
    const data = (templates.render as jest.Mock).mock.calls[0][1];
    expect(data.trackingNumber).toBe('RC9');
    expect(data.detailLink).toBe('https://app.example.com/operaciones/salidas-a-ruta?seguimiento=RC9');
  });
});

describe('MailService.sendHighPriorityShipmentsEmail', () => {
  it('renderiza por plantilla high_priority_shipments con la tabla del llamador y envía el html renderizado', async () => {
    const { svc, mailer, templates } = make();
    const htmlContent = '<table><tr><td>T1</td></tr></table>';
    await svc.sendHighPriorityShipmentsEmail({ to: 'a@x.com', htmlContent });

    expect(templates.render).toHaveBeenCalledWith('high_priority_shipments', { tableHtml: htmlContent });
    expect(mailer.sendMail).toHaveBeenCalled();
    const arg = mailer.sendMail.mock.calls[0][0];
    expect(arg.subject).toBe('Salida a ruta - Juan');
    expect(arg.html).toBe('<p>ok</p>');
    // Anti-spam: sin cabeceras de prioridad y con alternativa de texto plano.
    expect(arg.headers).toBeUndefined();
    expect(arg.text).toBe('ok');
  });
});

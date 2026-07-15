import { EmailService } from './email.service';

describe('EmailService (plantillas)', () => {
  it('sendOtpEmail renderiza password_reset_otp', async () => {
    const templates: any = { render: jest.fn(() => Promise.resolve({ subject: 'Tu código: 123456', html: '<p>123456</p>' })) };
    const mailer: any = { sendMail: jest.fn(() => Promise.resolve()) };
    const svc = new EmailService(templates, mailer);
    await svc.sendOtpEmail('u@x.com', '123456', 10);
    expect(templates.render).toHaveBeenCalledWith('password_reset_otp', { code: '123456', minutes: 10 });
    expect(mailer.sendMail).toHaveBeenCalled();
  });
});

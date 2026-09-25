import { ServiceUnavailableException } from '@nestjs/common';

jest.mock('playwright-core', () => ({
  chromium: { launch: jest.fn() },
}));

import { chromium } from 'playwright-core';
import { HtmlToPdfService } from './html-to-pdf.service';

describe('HtmlToPdfService', () => {
  it('si falta Chromium, explica cómo instalarlo en vez de un error opaco', async () => {
    (chromium.launch as jest.Mock).mockRejectedValueOnce(new Error("browserType.launch: Executable doesn't exist at C:\\ms-playwright\\headless_shell.exe"));
    const err = await new HtmlToPdfService().convert('<p>x</p>').catch((e) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect(err.message).toMatch(/npx playwright install chromium/);
  });

  it('otros fallos al abrir el navegador: mensaje genérico en llano', async () => {
    (chromium.launch as jest.Mock).mockRejectedValueOnce(new Error('spawn EPERM'));
    const err = await new HtmlToPdfService().convert('<p>x</p>').catch((e) => e);
    expect(err.message).toBe('No se pudo abrir el generador de PDF. Intenta de nuevo en un momento.');
  });
});

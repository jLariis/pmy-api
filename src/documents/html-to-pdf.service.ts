import { Injectable, Logger } from '@nestjs/common';
import { chromium } from 'playwright-core';

/** Aísla la conversión HTML→PDF con Chromium headless (playwright-core). */
@Injectable()
export class HtmlToPdfService {
  private readonly logger = new Logger(HtmlToPdfService.name);

  async convert(html: string): Promise<Buffer> {
    const launchOpts: any = process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : { channel: 'chrome' };
    const browser = await chromium.launch(launchOpts);
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle' });
      const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true });
      return Buffer.from(pdf);
    } finally {
      await browser.close().catch((e) => this.logger.warn(`cierre de Chromium: ${e?.message}`));
    }
  }
}

import { Injectable } from '@nestjs/common';
import * as Handlebars from 'handlebars';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { RenderContext } from './documents.types';

const TZ = 'America/Hermosillo';

/** Motor de interpolación logic-less. Escapa valores por defecto (anti-inyección). */
@Injectable()
export class TemplateEngine {
  private readonly hb: typeof Handlebars;

  constructor() {
    this.hb = Handlebars.create();
    this.hb.registerHelper('formatDate', (value: any) => {
      if (!value) return '';
      try {
        return format(toZonedTime(new Date(value), TZ), 'dd/MM/yyyy hh:mm aa');
      } catch {
        return String(value);
      }
    });
  }

  render(source: string, ctx: RenderContext): string {
    const tpl = this.hb.compile(source ?? '', { noEscape: false });
    return tpl({ ...ctx.data, brand: ctx.brand, system: ctx.system });
  }

  /** Interpolación SIN escape HTML — para destinos no-HTML (Excel), donde `->`, `'`, etc. deben quedar literales. */
  renderRaw(source: string, ctx: RenderContext): string {
    const tpl = this.hb.compile(source ?? '', { noEscape: true });
    return tpl({ ...ctx.data, brand: ctx.brand, system: ctx.system });
  }
}

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SupplierDto } from './supplier.dto';

/** Aplana errores anidados como los reporta el ValidationPipe ("contacts.0.<mensaje>"). */
async function messages(body: any): Promise<string[]> {
  const errors = await validate(plainToInstance(SupplierDto, body));
  const out: string[] = [];
  const walk = (errs: any[], path: string[]) => {
    for (const e of errs) {
      const p = [...path, e.property];
      if (e.constraints) out.push(...Object.values<string>(e.constraints).map((m) => (p.length > 1 ? `${p.slice(0, -1).join('.')}.${m}` : m)));
      if (e.children?.length) walk(e.children, p);
    }
  };
  walk(errors, []);
  return out;
}

describe('SupplierDto (mensajes en lenguaje simple)', () => {
  const base = { name: 'Taller X', contacts: [{ name: 'Juan', email: 'juan@taller.com', preferredChannel: 'email' }] };

  it('válido', async () => expect(await messages(base)).toEqual([]));

  it('correo mal escrito → mensaje en español con ejemplo', async () =>
    expect(await messages({ ...base, contacts: [{ ...base.contacts[0], email: 'juan@taller' }] })).toEqual([
      'contacts.0.El correo no es válido (ej. nombre@empresa.com)',
    ]));

  it('sin nombre ni contactos', async () => {
    const m = await messages({ name: '', contacts: [] });
    expect(m).toContain('Escribe el nombre o razón social del proveedor');
    expect(m).toContain('Agrega al menos un contacto');
    expect(m.join(' ')).not.toMatch(/must|should/);
  });
});

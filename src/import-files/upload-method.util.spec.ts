import { f2ModeDetail, f2SavedCount, normalizeUploadMethod, uploadMethodLabel } from './upload-method.util';

describe('upload-method.util', () => {
  it('acepta solo claves conocidas (sin importar mayúsculas/espacios)', () => {
    expect(normalizeUploadMethod(' Asistente ')).toBe('asistente');
    expect(normalizeUploadMethod('pegar_fedex')).toBe('pegar_fedex');
    expect(normalizeUploadMethod('processFileF2')).toBeNull();
    expect(normalizeUploadMethod(undefined)).toBeNull();
  });

  it('nombre en llano, con el modo F2 cuando aplica', () => {
    expect(uploadMethodLabel('asistente', f2ModeDetail(true))).toBe(
      'Asistente de subida (paso a paso) · F2 directo como carga (sin quitar de paquetes)',
    );
    expect(uploadMethodLabel('bandeja_correo')).toBe('Desde la bandeja de correos');
    expect(uploadMethodLabel(null)).toBe('Sin dato del método');
  });
});

describe('f2SavedCount', () => {
  it('suma nuevas + quitadas del master (F2 normal) o cuenta las cargas (F2 directo)', () => {
    expect(f2SavedCount({ summary: { insertedNew: 2, migrated: 7 } })).toBe(9);
    expect(f2SavedCount({ savedChargeShipments: [{}, {}] })).toBe(2);
    expect(f2SavedCount({ message: 'nada' })).toBeNull();
  });
});

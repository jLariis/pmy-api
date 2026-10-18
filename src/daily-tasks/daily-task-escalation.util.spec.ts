import { escalationActions } from './daily-task-escalation.util';

describe('escalationActions', () => {
  it('sin subir de nivel no se avisa nada', () => {
    expect(escalationActions(1, 1, 3)).toEqual({ bell: false, managersEmail: false, whatsapp: false });
  });
  it('nivel 1: campana a la sucursal', () => {
    expect(escalationActions(1, 0, 3)).toEqual({ bell: true, managersEmail: false, whatsapp: false });
  });
  it('nivel 2: también correo a encargados', () => {
    expect(escalationActions(2, 1, 3)).toEqual({ bell: true, managersEmail: true, whatsapp: false });
  });
  it('WhatsApp solo desde el nivel configurado para grupos', () => {
    expect(escalationActions(3, 2, 3).whatsapp).toBe(true);
    expect(escalationActions(2, 1, 2).whatsapp).toBe(true);
    expect(escalationActions(2, 1, 3).whatsapp).toBe(false);
  });
});

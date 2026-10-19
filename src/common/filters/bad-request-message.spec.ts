import { badRequestMessage } from './bad-request-message';

describe('badRequestMessage', () => {
  it('mensaje de texto → completo (antes salía solo la primera letra)', () => {
    expect(badRequestMessage({ message: 'Vista no válida.' }, 'Bad Request')).toBe('Vista no válida.');
  });
  it('lista de class-validator → el primero', () => {
    expect(badRequestMessage({ message: ['La guía es obligatoria', 'otro'] }, 'Bad Request')).toBe('La guía es obligatoria');
  });
  it('respuesta en texto → tal cual', () => {
    expect(badRequestMessage('Algo falló', 'Bad Request')).toBe('Algo falló');
  });
  it('sin mensaje → el de la excepción', () => {
    expect(badRequestMessage({}, 'Bad Request')).toBe('Bad Request');
  });
});

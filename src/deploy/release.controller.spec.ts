import { UnauthorizedException } from '@nestjs/common';
import { sessionUserId } from './release.controller';

describe('sessionUserId', () => {
  it('lee userId (lo que pone el JwtStrategy)', () => expect(sessionUserId({ user: { userId: 'u1' } })).toBe('u1'));
  it('acepta id como respaldo', () => expect(sessionUserId({ user: { id: 'u2' } })).toBe('u2'));
  it('sin usuario → no autorizado (nunca consulta con id vacío)', () =>
    expect(() => sessionUserId({ user: {} })).toThrow(UnauthorizedException));
});

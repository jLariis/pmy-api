import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Fuerza autenticación en un handler cuyo CONTROLADOR está marcado @Public a
 * nivel de clase. Como JwtAuthGuard resuelve `isPublic` con getAllAndOverride
 * (handler antes que clase), este `false` a nivel de método gana y hace que el
 * guard SÍ ejecute passport y pueble `req.user`.
 */
export const Protected = () => SetMetadata(IS_PUBLIC_KEY, false);

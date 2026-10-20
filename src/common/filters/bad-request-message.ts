/**
 * Mensaje de un 400 para el usuario. class-validator manda una lista (se toma el primero);
 * un `BadRequestException('texto')` manda el texto completo.
 */
export function badRequestMessage(response: unknown, fallback: string): string {
  if (typeof response === 'string') return response;
  const message = (response as { message?: unknown } | null)?.message;
  if (Array.isArray(message)) return String(message[0] ?? fallback);
  if (typeof message === 'string' && message) return message;
  return fallback;
}

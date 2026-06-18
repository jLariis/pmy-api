/** Obtiene la IP real del cliente respetando proxies (x-forwarded-for). */
export function getClientIp(req: any): string {
  const xf = (req?.headers?.['x-forwarded-for'] || '') as string;
  return (xf.split(',')[0] || req?.ip || req?.socket?.remoteAddress || '').toString().trim();
}

/** Calcula el diff entre dos estados (ignora campos ruidosos/sensibles). */
export function buildDiff(
  before: any,
  after: any,
): Record<string, { from: any; to: any }> | undefined {
  if (!before || !after) return undefined;
  const IGNORE = ['password', 'updatedAt', 'createdAt'];
  const changes: Record<string, { from: any; to: any }> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    if (IGNORE.includes(k)) continue;
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
      changes[k] = { from: before[k] ?? null, to: after[k] ?? null };
    }
  }
  return Object.keys(changes).length ? changes : undefined;
}

const SENSITIVE = ['password', 'token', 'accessToken', 'access_token', 'authorization', 'secret', 'refreshToken'];

/** Enmascara datos sensibles antes de persistir en auditoría. */
export function redact<T = any>(obj?: T): T | undefined {
  if (!obj || typeof obj !== 'object') return obj;
  const clone: any = Array.isArray(obj) ? [...(obj as any)] : { ...(obj as any) };
  for (const k of Object.keys(clone)) {
    if (SENSITIVE.includes(k)) clone[k] = '***';
    else if (clone[k] && typeof clone[k] === 'object') clone[k] = redact(clone[k]);
  }
  return clone;
}

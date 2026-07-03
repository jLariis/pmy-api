import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import type { GuacProtocol } from './guacd-client';

export interface RemoteConnectionConfig {
  protocol: GuacProtocol;
  settings: Record<string, string>;
}

/** Clave de 32 bytes en hex → GUAC_TOKEN_KEY (genera: `openssl rand -hex 32`). */
function key(): Buffer {
  const hex = process.env.GUAC_TOKEN_KEY ?? '';
  const buf = Buffer.from(hex, 'hex');
  if (buf.length !== 32) {
    throw new Error('GUAC_TOKEN_KEY inválida: se requieren 32 bytes en hex (openssl rand -hex 32).');
  }
  return buf;
}

/** Cifra la config de conexión (protocolo + credenciales) → token opaco para el navegador. */
export function encryptConnectionToken(cfg: RemoteConnectionConfig): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(cfg), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64url');
}

/** Descifra el token en el gateway (única parte que ve las credenciales reales). */
export function decryptConnectionToken(token: string): RemoteConnectionConfig {
  const raw = Buffer.from(token, 'base64url');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  const json = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  return JSON.parse(json) as RemoteConnectionConfig;
}

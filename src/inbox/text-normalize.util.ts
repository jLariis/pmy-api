/**
 * Normalización de texto de correos FedEx: comparación robusta (sin acentos ni
 * puntuación), corte del historial del hilo y limpieza de bloques repetitivos.
 */

export function normalize(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/** Líneas que abren un mensaje citado (Outlook/Gmail, inglés y español). */
const QUOTE_START = [
  /^\s*From:\s/i,
  /^\s*De:\s/i,
  /^\s*Enviado:\s/i,
  /^\s*Sent:\s/i,
  /^\s*-{2,}\s*(Original Message|Mensaje original)/i,
  /^\s*On .+ wrote:\s*$/i,
  /^\s*El .+ escribi[oó]:\s*$/i,
];

export function cutQuotedHistory(text: string): { top: string; hadHistory: boolean } {
  const lines = (text ?? '').split(/\r?\n/);
  const idx = lines.findIndex((l) => QUOTE_START.some((re) => re.test(l)));
  if (idx < 0) return { top: text ?? '', hadHistory: false };
  return { top: lines.slice(0, idx).join('\n'), hadHistory: true };
}

/** Línea donde empieza la firma (despedida o renglón tipo "NOMBRE | PUESTO | FEDEX"). */
const SIGNATURE_START = [
  /^\s*(saludos|best regards|atentamente|cordialmente)\b/i,
  /^\s*fedex,?\s+vivimos para entregar/i,
  /\|.*fedex|fedex.*\|/i,
];

/** Separa el cuerpo de la firma; la firma solo sirve para inferir región. */
export function splitSignature(top: string): { body: string; signature: string } {
  const lines = (top ?? '').split(/\r?\n/);
  const idx = lines.findIndex((l) => SIGNATURE_START.some((re) => re.test(l)));
  if (idx < 0) return { body: top ?? '', signature: '' };
  return { body: lines.slice(0, idx).join('\n'), signature: lines.slice(idx).join('\n') };
}

const BOILERPLATE = [
  /\*{0,2}\s*IMPORTANTE\s*\*{0,2}[\s\S]*?(no enviado a tiempo\.?)/gi,
  /Caution!.*?(suspicious origin\.?|$)/gim,
  /Sensitive-External\s*-?/gi,
];

export function stripBoilerplate(text: string): string {
  let t = text ?? '';
  for (const re of BOILERPLATE) t = t.replace(re, ' ');
  return t;
}

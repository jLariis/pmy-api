/**
 * CLABE interbancaria (México): 18 dígitos = banco(3) + plaza(3) + cuenta(11) + dígito verificador(1).
 * Dígito verificador: pesos 3,7,1 cíclicos; se suma (dígito*peso mod 10); DV = (10 - suma mod 10) mod 10.
 * ESPEJO en app-pmy `lib/clabe.ts` — mantener en sync.
 */
const WEIGHTS = [3, 7, 1];

export function clabeCheckDigit(first17: string): number {
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += (Number(first17[i]) * WEIGHTS[i % 3]) % 10;
  return (10 - (sum % 10)) % 10;
}

export function isValidClabe(raw: string | null | undefined): boolean {
  const d = String(raw ?? '').replace(/\s/g, '');
  if (!/^\d{18}$/.test(d)) return false;
  return clabeCheckDigit(d.slice(0, 17)) === Number(d[17]);
}

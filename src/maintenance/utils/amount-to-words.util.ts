const UNITS = [
  '', 'UN', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ', 'ONCE', 'DOCE', 'TRECE',
  'CATORCE', 'QUINCE', 'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE', 'VEINTE', 'VEINTIÚN', 'VEINTIDÓS',
  'VEINTITRÉS', 'VEINTICUATRO', 'VEINTICINCO', 'VEINTISÉIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE',
];
const TENS = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
const HUNDREDS = [
  '', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS',
  'OCHOCIENTOS', 'NOVECIENTOS',
];

function under100(n: number): string {
  if (n < 30) return UNITS[n];
  const d = Math.floor(n / 10);
  const u = n % 10;
  return u ? `${TENS[d]} Y ${UNITS[u]}` : TENS[d];
}

function under1000(n: number): string {
  if (n === 100) return 'CIEN';
  const c = Math.floor(n / 100);
  const r = n % 100;
  return [HUNDREDS[c], r ? under100(r) : ''].filter(Boolean).join(' ');
}

function integerToWords(n: number): string {
  if (n === 0) return 'CERO';
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;
  const parts: string[] = [];
  if (millions) parts.push(millions === 1 ? 'UN MILLÓN' : `${integerToWords(millions)} MILLONES`);
  if (thousands) parts.push(thousands === 1 ? 'MIL' : `${under1000(thousands)} MIL`);
  if (rest) parts.push(under1000(rest));
  return parts.join(' ');
}

/** Importe con letra estilo factura MX: "MIL DOSCIENTOS PESOS 50/100 M.N.". */
export function amountToWordsMXN(n: number): string {
  const cents = Math.round(Number(n || 0) * 100);
  const int = Math.floor(cents / 100);
  const c = String(cents % 100).padStart(2, '0');
  const exactMillions = int >= 1_000_000 && int % 1_000_000 === 0;
  const unit = int === 1 ? 'PESO' : exactMillions ? 'DE PESOS' : 'PESOS';
  return `${integerToWords(int)} ${unit} ${c}/100 M.N.`;
}

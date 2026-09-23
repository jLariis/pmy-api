/** Normaliza un teléfono MX a formato WhatsApp (`52` + 10 dígitos). Null si no es válido. */
export function toWhatsappNumber(raw: string | null | undefined): string | null {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('521') && d.length === 13) d = d.slice(3);
  else if (d.startsWith('52') && d.length === 12) d = d.slice(2);
  return d.length === 10 ? `52${d}` : null;
}

/**
 * Código de excepción FedEx CANÓNICO. FedEx a veces manda variantes de un mismo código
 * (caso Hermosillo 17-oct-2026: "08D" = cliente no disponible, igual que "08"). Si la variante
 * pasa tal cual, se salta todo lo que compara el código exacto: la regla de 3 visitas de DEX08,
 * `charge_rule` (sin regla → cobra) y el mapeo de estatus. Se normaliza donde entra el dato de
 * FedEx y en los lectores de cobro, para que todo vea el código base.
 */
const FEDEX_EXCEPTION_CODE_ALIASES: Record<string, string> = {
  '08D': '08',
};

/** Devuelve el código base ('08D' → '08'); el resto se regresa recortado, sin cambiar. */
export function canonicalFedexExceptionCode<T extends string | null | undefined>(code: T): T {
  if (!code) return code;
  const trimmed = code.trim();
  return (FEDEX_EXCEPTION_CODE_ALIASES[trimmed.toUpperCase()] ?? trimmed) as T;
}

/** Espejo SQL de `canonicalFedexExceptionCode` para una columna de código. */
export function canonicalFedexExceptionCodeSql(column: string): string {
  const cases = Object.entries(FEDEX_EXCEPTION_CODE_ALIASES)
    .map(([alias, base]) => `WHEN '${alias}' THEN '${base}'`)
    .join(' ');
  return `(CASE UPPER(TRIM(${column})) ${cases} ELSE ${column} END)`;
}

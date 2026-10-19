/**
 * Qué avisos manda un atraso al subir de nivel (0 a tiempo · 1 vencido · 2 · 3, ver `alertLevel`).
 * Campana a la sucursal desde el 1; correo a encargados desde el 2; WhatsApp una sola vez al
 * alcanzar el nivel de grupos configurado (nunca antes del 2: solo atrasos importantes).
 */
export function escalationActions(level: number, prevLevel: number, groupsLevel: number): { bell: boolean; managersEmail: boolean; whatsapp: boolean } {
  if (level <= prevLevel) return { bell: false, managersEmail: false, whatsapp: false };
  const waFrom = Math.max(groupsLevel || 1, 2);
  return { bell: level >= 1, managersEmail: level >= 2, whatsapp: level >= waFrom && prevLevel < waFrom };
}

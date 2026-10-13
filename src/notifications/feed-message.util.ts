/**
 * Mensaje de la campana: quién (y de qué sucursal) hizo qué. Las notificaciones nuevas guardan el
 * actor aparte y la campana solo pinta el texto, así que se veían genéricas ("Importó archivo…");
 * el feed anterior decía "Maria Manzanilla: …". Si el texto ya nombra a la persona, no se repite.
 */
export function composeFeedMessage(input: {
  actorName?: string | null;
  subsidiaryName?: string | null;
  body?: string | null;
  title?: string | null;
}): string {
  const text = String(input.body ?? input.title ?? '').trim();
  const actor = String(input.actorName ?? '').trim();
  if (!actor || actor === 'Sistema' || text.toLowerCase().includes(actor.toLowerCase())) return text;
  const who = input.subsidiaryName ? `${actor} · ${input.subsidiaryName}` : actor;
  return text ? `${who} — ${text}` : who;
}

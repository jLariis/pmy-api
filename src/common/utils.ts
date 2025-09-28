export function formatToHermosillo(timestamp: string | Date): string {
  const date = new Date(timestamp);

  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Hermosillo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}


// helpers/timezone.ts
function getTimezoneOffsetMs(date: Date, timeZone: string): number {
  // Devuelve: Date.UTC(parts) - date.getTime() => offset (ms) que transforma `date` (instante UTC)
  // a la representación local en timeZone.
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts = dtf.formatToParts(date).reduce<Record<string, string>>((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value;
    return acc;
  }, {});

  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const second = Number(parts.second);

  return Date.UTC(year, month - 1, day, hour, minute, second) - date.getTime();
}

export function zonedTimeToUtc(localDate: Date, timeZone: string): Date {
  // `localDate` es la hora "de reloj" en la zona (ej: new Date(yyyy, m, d) => 00:00 local).
  // Construimos UTC para las mismas componentes y ajustamos con el offset real de la zona.
  const year = localDate.getFullYear();
  const month = localDate.getMonth();
  const day = localDate.getDate();
  const hour = localDate.getHours();
  const minute = localDate.getMinutes();
  const second = localDate.getSeconds();

  // timestamp UTC para esas mismas componentes numéricas
  const tentativeUtcTs = Date.UTC(year, month, day, hour, minute, second);

  // offset MS de la zona en ese instante (IMPORTANTE: se calcula usando el instante tentativeUtcTs)
  const offsetMs = getTimezoneOffsetMs(new Date(tentativeUtcTs), timeZone);

  // La fecha UTC real que corresponde a "localDate en timeZone" es:
  return new Date(tentativeUtcTs - offsetMs);
}

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
import { ScanEventDto } from "src/shipments/dto/fedex/scan-event.dto";

export const scanEventsFilter = (
  scanEvents: ScanEventDto[],
  filterBy: string = ""
): ScanEventDto[] => {
  if (!filterBy.trim()) return scanEvents;

  // 1. Clonar y ordenar de más ANTIGUO a más RECIENTE
  const sortedEvents = [...scanEvents].sort((a, b) => 
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  // 2. Buscar el PRIMER evento que coincida
  const lowerFilter = filterBy.toLowerCase();
  const firstMatchIndex = sortedEvents.findIndex(event =>
    event.eventDescription?.toLowerCase().includes(lowerFilter)
  );

  if (firstMatchIndex === -1) return [];

  // 3. Cortar desde la coincidencia hasta el FINAL (eventos más recientes)
  const result = sortedEvents.slice(firstMatchIndex);

  // 4. Opcional: Volver a ordenar de más RECIENTE a más ANTIGUO
  return result.reverse();
};
  

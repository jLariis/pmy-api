import { FedExScanEventDto } from "src/shipments/dto/fedex/fedex-tracking-response.dto";
import { ScanEventDto } from "src/shipments/dto/fedex/scan-event.dto";

export const scanEventsFilter = (
  scanEvents: FedExScanEventDto[],
  filterBy: string = ""
): FedExScanEventDto[] => {
  if (!filterBy.trim()) return scanEvents;

  // 1. Clonar y ordenar de más ANTIGUO a más RECIENTE
  const sortedEvents = [...scanEvents].sort((a, b) => 
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  const firstMatchIndex = sortedEvents.findIndex(event =>
    event.exceptionDescription.includes(filterBy) || 
    event.eventDescription.includes(filterBy)
  );

  if (firstMatchIndex === -1) return [];

  // 3. Cortar desde la coincidencia hasta el FINAL (eventos más recientes)
  const result = sortedEvents.slice(firstMatchIndex);

  // 4. Opcional: Volver a ordenar de más RECIENTE a más ANTIGUO
  return result.reverse();
};
  

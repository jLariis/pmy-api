import { ShipmentType } from "src/common/enums";
import { ConsolidatedType } from "src/common/enums/consolidated-type.enum";
import { PaymentTypeEnum } from "src/common/enums/payment-type.enum";
import { Priority } from "src/common/enums/priority.enum";

// Detalle de chofer/unidad asociado a un despacho (package_dispatch) identificado
// a partir del "Folio Despacho" que viene embebido en las notas del shipment_status.
export class TimelineDispatchDto {
    id: string;
    folio: string;          // packageDispatch.trackingNumber
    driverName: string;
    vehicle: string | null; // placas / número económico de la unidad, según tu entidad
}

// Un evento del historial completo del envío (shipment_status), humanizado y,
// cuando aplica (status = en_ruta con folio identificable), enriquecido con el despacho.
export class StatusTimelineEntryDto {
    status: string;
    statusLabel: string;
    date: string | null;
    notes: string | null;
    exceptionCode: string | null;
    dispatch?: TimelineDispatchDto;
}

export class SearchShipmentDto {
    trackingNumber: string;
    recipient: {
        name: string;
        address: string;
        phoneNumber: string;
        zipCode: string
    }
    commitDateTime: string;
    priority: Priority;
    payment: {
        type: PaymentTypeEnum;
        amount: number;
    };
    status: string;
    shipmentType: ShipmentType;
    subsidiary: string;
    unloading: {
        id: string;
        trackingNumber: string;
    };
    isCharge?: boolean;
    // Ruta activa: solo viene definida cuando el último estatus del historial
    // (shipmentStatus) sigue siendo "en_ruta". Si el envío ya avanzó de estatus
    // (entregado, no entregado, etc.) esta propiedad viene undefined.
    route: undefined | {
        id: string;
        trackingNumber: string;
        driver: {
            name: string
        };
        vehicle: string | null;
        // Fecha en la que entró al estatus "en_ruta" vigente (ISO string)
        date: string | null;
    };
    // Historial completo del envío: todos los estatus por los que pasó, en orden
    // cronológico, con chofer/unidad cuando el evento es una salida a ruta
    // identificable por su Folio Despacho.
    statusTimeline?: StatusTimelineEntryDto[];
    consolidated?: {
        id: string;
        type: ConsolidatedType;
    };
    charge?: {  // Agregar esta propiedad opcional
        id: string;
        type: string;  // Puedes usar un enum específico si lo tienes
    };
}
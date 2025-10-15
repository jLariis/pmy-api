import { ConsolidatedType } from "src/common/enums/consolidated-type.enum";
import { PaymentTypeEnum } from "src/common/enums/payment-type.enum";
import { Priority } from "src/common/enums/priority.enum";

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
    subsidiary: string;
    unloading: {
        id: string;
        trackingNumber: string;
    };
    route: undefined | {
        id: string;
        trackingNumber: string;
        driver: {
            name: string
        }
    };
    consolidated?: {
        id: string;
        type: ConsolidatedType;
    };
    charge?: {  // Agregar esta propiedad opcional
        id: string;
        type: string;  // Puedes usar un enum específico si lo tienes
    };
}
import { Subsidiary } from "src/entities/subsidiary.entity";

export class CollectionDto {
    trackingNumber: string;
    subsidiary: Subsidiary;
    status?: string;
    isPickUp: boolean;
    date?: string;
}
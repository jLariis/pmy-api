import { Subsidiary } from "src/entities/subsidiary.entity";

export class CollectionDto {
    trackingNumber: string;
    subsidiary: Subsidiary;
    subsidiaryId: string;
    status?: string;
    isPickUp: boolean;
}
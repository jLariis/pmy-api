import { Subsidiary } from "src/entities";

export class CreateDevolutionDto {
    trackingNumber: string;
    subsidiary: Subsidiary;
    date?: Date;
    status?: string;
    isCharge?: boolean;
    hasIncome?: boolean;
}

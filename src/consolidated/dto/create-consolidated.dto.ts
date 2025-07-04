import { ConsolidatedType } from "src/common/enums/consolidated-type.enum";

export class CreateConsolidatedDto {
    date: string;
    type: ConsolidatedType;
    numberOfPackages: number;
    subsidiaryId: string;
    isCompleted: boolean;
    consNumber: string;
    efficiency: number;
}

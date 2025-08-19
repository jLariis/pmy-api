import { IsArray, IsString } from "class-validator";
import { Subsidiary, Vehicle } from "src/entities";

export class CreateUnloadingDto {
    vehicle?: Vehicle;
    subsidiary?: Subsidiary;
    
    @IsArray()
    @IsString({ each: true })
    shipments: string[];
    
    missingTrackings: string[];
    unScannedTrackings: string[];
    date: string;
}

import { IsArray, IsString } from "class-validator";

export class ValidateTrackingsForClosureDto {
    @IsArray()
    trackingNumbers: string[];

    @IsString()
    packageDispatchId: string;
}
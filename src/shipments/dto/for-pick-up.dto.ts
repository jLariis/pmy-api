import { IsString } from "class-validator";

export class ForPickUpDto {
    @IsString()
    trackingNumber: string
}
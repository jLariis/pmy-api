import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { TrackResultDto } from "./track-result.dto";

export class CompleteTrackResultDto {
  @ApiProperty()
  trackingNumber: string;

  @ApiProperty({ type: [TrackResultDto] })
  @Type(() => TrackResultDto)
  trackResults: TrackResultDto[];
}
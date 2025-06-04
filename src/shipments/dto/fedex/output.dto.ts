import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { CompleteTrackResultDto } from "./complete-track-result.dto";

export class OutputDto {
  @ApiProperty({ type: [CompleteTrackResultDto] })
  @Type(() => CompleteTrackResultDto)
  completeTrackResults: CompleteTrackResultDto[];
}
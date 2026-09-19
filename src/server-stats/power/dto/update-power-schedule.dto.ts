import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEmail,
  IsInt,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { TIME_RE } from '../power-schedule.util';

export class UpdatePowerScheduleDto {
  @IsBoolean()
  enabled: boolean;

  @Matches(TIME_RE, { message: 'suspendTime debe ser HH:MM (00:00–23:59)' })
  suspendTime: string;

  @Matches(TIME_RE, { message: 'wakeTime debe ser HH:MM (00:00–23:59)' })
  wakeTime: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  days: number[];

  @IsArray()
  @ArrayNotEmpty()
  @IsEmail({}, { each: true })
  recipients: string[];
}

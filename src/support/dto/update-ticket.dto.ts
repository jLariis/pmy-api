import { IsIn, IsOptional, IsString } from 'class-validator';
import { ALL_STATES, TicketStatus } from '../support-logic';

export class UpdateTicketDto {
  @IsIn(ALL_STATES) @IsOptional()
  estado?: TicketStatus;
  @IsIn(['baja', 'media', 'alta', 'urgente']) @IsOptional()
  prioridad?: 'baja' | 'media' | 'alta' | 'urgente';
  @IsString() @IsOptional() assigneeId?: string;
}

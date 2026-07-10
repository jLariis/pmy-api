import { IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateTicketDto {
  @IsIn(['pendiente', 'en_progreso', 'completado', 'rechazado']) @IsOptional()
  estado?: 'pendiente' | 'en_progreso' | 'completado' | 'rechazado';
  @IsIn(['baja', 'media', 'alta', 'urgente']) @IsOptional()
  prioridad?: 'baja' | 'media' | 'alta' | 'urgente';
  @IsString() @IsOptional() assigneeId?: string;
}

import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty } from 'class-validator';

// Definimos los tipos permitidos para reutilizarlos
export enum AuditEntityType {
  TRACKINGS = 'trackings',
  DISPATCH = 'dispatch',
  CONSOLIDATED = 'consolidated',
  UNLOADING = 'unloading',
}

export class UniversalAuditDto {
  @ApiProperty({
    description: 'Tipo de entidad a auditar',
    enum: AuditEntityType,
    example: 'consolidated',
  })
  @IsEnum(AuditEntityType, { message: 'El entityType debe ser: trackings, dispatch, consolidated o unloading' })
  entityType: AuditEntityType;

  @ApiProperty({
    description: 'Identificador único (UUID) o Folio Público (ej. CON-2026). Soporta string único o array.',
    oneOf: [
      { type: 'string' },
      { type: 'array', items: { type: 'string' } },
    ],
    examples: {
      simple: { summary: 'Un solo ID', value: 'a0eebc99-9c0b...' },
      array: { summary: 'Lista de Folios', value: ['CON-2026-001', 'CON-2026-002'] },
    },
  })
  @IsNotEmpty({ message: 'El identificador es obligatorio' })
  identifier: string | string[];
}
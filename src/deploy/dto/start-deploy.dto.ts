import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

export class ReleaseNoteDto {
  @IsString({ message: 'Cada nota necesita un identificador.' })
  @MaxLength(200)
  id: string;

  @IsIn(['nuevo', 'mejora', 'rapido', 'correccion'], { message: 'El tipo de la nota no es válido.' })
  kind: 'nuevo' | 'mejora' | 'rapido' | 'correccion';

  @IsString({ message: 'Cada nota necesita un título.' })
  @MaxLength(200, { message: 'El título de la nota es muy largo.' })
  title: string;

  @IsString({ message: 'Cada nota necesita un resumen.' })
  @MaxLength(1000, { message: 'El resumen de la nota es muy largo.' })
  summary: string;

  @IsOptional() @IsString() @MaxLength(300)
  where?: string;

  @IsOptional() @IsString() @MaxLength(300)
  route?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true })
  steps?: string[];

  @IsOptional() @IsIn(['todos', 'superadmin'])
  audience?: 'todos' | 'superadmin';

  @IsIn(['api', 'web'])
  source: 'api' | 'web';

  @IsOptional()
  fromCommit?: boolean;
}

export class StartDeployDto {
  @IsIn(['patch', 'minor', 'major'], { message: 'Elige el tipo de cambio (menor, mayor o muy grande).' })
  bump: 'patch' | 'minor' | 'major';

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ReleaseNoteDto)
  notes: ReleaseNoteDto[];
}

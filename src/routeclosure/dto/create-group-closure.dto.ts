import { ArrayMinSize, IsArray, IsObject, IsString } from 'class-validator';
import type { GroupClosureInput } from '../group-closure.util';

/** Cierre agrupado: las salidas a cerrar juntas + el cierre capturado una sola vez. */
export class CreateGroupClosureDto {
  @IsArray({ message: 'Las rutas deben venir en una lista' })
  @ArrayMinSize(2, { message: 'Elige al menos dos rutas para cerrarlas juntas' })
  @IsString({ each: true, message: 'Ruta no válida' })
  dispatchIds: string[];

  @IsObject({ message: 'Falta la información del cierre' })
  closure: GroupClosureInput;
}

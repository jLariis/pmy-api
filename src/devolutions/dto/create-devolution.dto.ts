import { IsBoolean, IsDefined, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';
import { Subsidiary } from 'src/entities';

export class CreateDevolutionDto {
    @IsString()
    @IsNotEmpty()
    trackingNumber: string;

    @IsDefined()
    @IsObject()
    subsidiary: Subsidiary;

    @IsOptional()
    date?: Date;

    @IsOptional()
    @IsString()
    status?: string;

    /** Motivo (la entidad lo requiere). En el flujo se llena con el exceptionCode de FedEx. */
    @IsOptional()
    @IsString()
    reason?: string;

    @IsOptional()
    @IsBoolean()
    isCharge?: boolean;

    @IsOptional()
    @IsBoolean()
    hasIncome?: boolean;

    /**
     * El usuario CONFIRMÓ en el front que, al devolver esta guía a FedEx, se anule su ingreso
     * `entregado` vigente. Solo entonces `processOneDevolution` lo anula (soft) + crea la reversa.
     * Sin este flag, el ingreso no se toca (sale en Reconciliación de cobros para revisión manual).
     */
    @IsOptional()
    @IsBoolean()
    annulEntregadoIncome?: boolean;
}

import { IsString } from 'class-validator';

export class ValidateOneRequestDto {
  @IsString()
  trackingNumber: string;

  @IsString()
  subsidiaryId: string;
}

export class ValidatedOneDto {
  id?: string;
  trackingNumber: string;
  /** Variante DHL (JD/JJD) del registro; permite casar la guía escaneada por DHL en el cliente. */
  dhlUniqueId?: string;
  isValid: boolean;
  isCharge: boolean;
  reason?: string;
  consolidatedId?: string;
  recipientName?: string;
  recipientAddress?: string;
  recipientPhone?: string;
  recipientZip?: string;
  recipientCity?: string;
  /** Paquetería (fedex/dhl): la captura agrupa y filtra por ella. */
  shipmentType?: string;
  priority?: string;
  isHighValue?: boolean;
  payment?: any;
  commitDateTime?: string;
  /**
   * Motivo si la guía ya está en estatus final ("Ya fue entregada"…): cuenta en el desembarque
   * y en su consolidado, pero al procesar no cambia de estatus.
   */
  alreadyFinal?: string;
}

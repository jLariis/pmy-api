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
  isValid: boolean;
  isCharge: boolean;
  reason?: string;
  consolidatedId?: string;
  recipientName?: string;
  recipientAddress?: string;
  recipientPhone?: string;
  recipientZip?: string;
  priority?: string;
  isHighValue?: boolean;
  payment?: any;
  commitDateTime?: string;
}

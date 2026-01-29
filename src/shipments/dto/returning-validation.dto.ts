export interface ReturnValidationDto {
  id: string;
  trackingNumber: string;
  status: string;
  recipientName: string;
  recipientAddress: string;
  recipientPhone: string;
  recipientZip: string;
  subsidiaryId: string;
  subsidiaryName: string;
  hasIncome: boolean;
  isCharge: boolean;
  lastStatus: {
    type: string | null;
    exceptionCode: string | null;
    notes: string | null;
  } | null;
}
export class ShipmentStatusForReportDto {
    trackingNumber: string;
    recipientName: string;
    recipientAddress: string;
    recipientZip: string;
    recipientPhone: string;
    doItByUser?: string;
    timestamp: string;
}
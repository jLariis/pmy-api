import { CanonicalRow, ImportJobKind } from './import-jobs.types';

export class CreateImportJobDto {
  kind: ImportJobKind;
  subsidiaryId: string;
  consNumber: string;
  consDate?: string;
  isAereo?: boolean;
  isHalfTon?: boolean;
  notRemoveCharge?: boolean;
  source?: 'paste' | 'retry';
  rows: CanonicalRow[];
}

export class PreviewImportDto {
  kind: ImportJobKind;
  subsidiaryId: string;
  consNumber: string;
  consDate?: string;
  notRemoveCharge?: boolean;
  rows: CanonicalRow[];
}

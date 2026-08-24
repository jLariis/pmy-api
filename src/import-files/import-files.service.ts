import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { promises as fs } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { ImportFile, ImportFileKind } from 'src/entities/import-file.entity';
import { Consolidated } from 'src/entities/consolidated.entity';
import { ShipmentType } from 'src/common/enums/shipment-type.enum';

export interface PersistMeta {
  kind: ImportFileKind;
  subsidiaryId?: string | null;
  consNumber?: string | null;
  rowCount?: number | null;
  uploadedById?: string | null;
  uploadedByName?: string | null;
}

/**
 * Persistencia y consulta de los archivos originales de importación FedEx.
 * El binario vive en disco bajo uploads/imports/fedex/<consNumber|fecha>/.
 */
@Injectable()
export class ImportFilesService {
  private readonly logger = new Logger(ImportFilesService.name);

  constructor(
    @InjectRepository(ImportFile) private readonly repo: Repository<ImportFile>,
    @InjectRepository(Consolidated) private readonly consRepo: Repository<Consolidated>,
  ) {}

  private abs(rel: string): string { return join(process.cwd(), rel); }

  private safeName(name: string): string {
    return (name || 'archivo').replace(/[^\w.\-]+/g, '_').slice(0, 120);
  }

  private async resolveConsolidatedId(consNumber?: string | null, subsidiaryId?: string | null): Promise<string | null> {
    if (!consNumber) return null;
    try {
      const where: any = { consNumber, carrier: ShipmentType.FEDEX };
      if (subsidiaryId) where.subsidiary = { id: subsidiaryId };
      const c = await this.consRepo.findOne({ where });
      return c?.id ?? null;
    } catch {
      return null;
    }
  }

  async persist(
    file: { originalname: string; buffer: Buffer; mimetype?: string },
    meta: PersistMeta,
  ): Promise<ImportFile> {
    const folder = this.safeName(meta.consNumber || new Date().toISOString().slice(0, 10));
    const relDir = join('uploads', 'imports', 'fedex', folder);
    await fs.mkdir(this.abs(relDir), { recursive: true });
    const stored = `${randomUUID()}-${this.safeName(file.originalname)}`;
    const relPath = join(relDir, stored);
    await fs.writeFile(this.abs(relPath), file.buffer);

    const consolidatedId = await this.resolveConsolidatedId(meta.consNumber, meta.subsidiaryId);
    const row = this.repo.create({
      carrier: 'FEDEX',
      kind: meta.kind,
      originalName: file.originalname,
      storagePath: relPath,
      mimeType: file.mimetype || 'application/octet-stream',
      size: file.buffer.length,
      rowCount: meta.rowCount ?? null,
      subsidiaryId: meta.subsidiaryId ?? null,
      consNumber: meta.consNumber ?? null,
      consolidatedId,
      uploadedById: meta.uploadedById ?? null,
      uploadedByName: meta.uploadedByName ?? null,
    });
    return this.repo.save(row);
  }

  async list(params: { subsidiaryId?: string; kind?: string; from?: Date; to?: Date; limit?: number } = {}): Promise<ImportFile[]> {
    const where: any = {};
    if (params.subsidiaryId) where.subsidiaryId = params.subsidiaryId;
    if (params.kind) where.kind = params.kind;
    if (params.from && params.to) where.createdAt = Between(params.from, params.to);
    else if (params.from) where.createdAt = MoreThanOrEqual(params.from);
    else if (params.to) where.createdAt = LessThanOrEqual(params.to);
    return this.repo.find({ where, order: { createdAt: 'DESC' }, take: params.limit ?? 200 });
  }

  async findByConsolidated(consolidatedId: string): Promise<ImportFile[]> {
    return this.repo.find({ where: { consolidatedId }, order: { createdAt: 'DESC' } });
  }

  async getDownloadable(id: string): Promise<{ buffer: Buffer; originalName: string; mimeType: string }> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Archivo de importación no encontrado');
    try {
      const buffer = await fs.readFile(this.abs(row.storagePath));
      return { buffer, originalName: row.originalName, mimeType: row.mimeType };
    } catch {
      throw new NotFoundException('El archivo ya no está disponible en disco');
    }
  }
}

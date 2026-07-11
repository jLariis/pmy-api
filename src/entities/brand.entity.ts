// src/entities/brand.entity.ts
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export interface BrandColors { primary?: string; secondary?: string; button?: string; text?: string; background?: string; }
export interface BrandTypography { fontFamily?: string; baseSize?: string; }
export interface BrandFiscal { razonSocial?: string; rfc?: string; direccion?: string; }
export interface BrandContact { phone?: string; email?: string; website?: string; }
export interface BrandSocial { facebook?: string; instagram?: string; whatsapp?: string; }

/** Identidad visual GLOBAL de la empresa (una fila, key='default'). */
@Entity('brand')
export class Brand {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 40, default: 'default' }) key: string;
  @Column({ type: 'varchar', length: 500, nullable: true }) logoLight: string | null;
  @Column({ type: 'varchar', length: 500, nullable: true }) logoDark: string | null;
  @Column({ type: 'json', nullable: true }) colors: BrandColors | null;
  @Column({ type: 'json', nullable: true }) typography: BrandTypography | null;
  @Column({ type: 'varchar', length: 20, nullable: true }) borderRadius: string | null;
  @Column({ type: 'json', nullable: true }) spacing: Record<string, string> | null;
  @Column({ type: 'json', nullable: true }) fiscal: BrandFiscal | null;
  @Column({ type: 'json', nullable: true }) contact: BrandContact | null;
  @Column({ type: 'json', nullable: true }) social: BrandSocial | null;
  @Column({ type: 'char', length: 36, nullable: true }) tenantId: string | null;
  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' }) updatedAt: Date;
}

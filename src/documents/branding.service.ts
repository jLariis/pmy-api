import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Brand } from 'src/entities/brand.entity';
import { BrandTokens, DEFAULT_BRAND_TOKENS } from './documents.types';

@Injectable()
export class BrandingService {
  private readonly logger = new Logger(BrandingService.name);
  private cache: BrandTokens | null = null;

  constructor(@InjectRepository(Brand) private readonly repo: Repository<Brand>) {}

  async getTokens(): Promise<BrandTokens> {
    if (this.cache) return this.cache;
    let row: Brand | null = null;
    try {
      row = await this.repo.findOne({ where: { key: 'default' } });
    } catch (e: any) {
      this.logger?.warn(`no se pudo leer branding, usando defaults: ${e?.message}`);
    }
    const d = DEFAULT_BRAND_TOKENS;
    this.cache = {
      logoLight: row?.logoLight ?? d.logoLight,
      logoDark: row?.logoDark ?? d.logoDark,
      colors: { ...d.colors, ...(row?.colors ?? {}) },
      typography: { ...d.typography, ...(row?.typography ?? {}) },
      borderRadius: row?.borderRadius ?? d.borderRadius,
      fiscal: { ...d.fiscal, ...(row?.fiscal ?? {}) },
      contact: { ...d.contact, ...(row?.contact ?? {}) },
      social: { ...d.social, ...(row?.social ?? {}) },
    };
    return this.cache;
  }

  invalidate(): void {
    this.cache = null;
  }
}

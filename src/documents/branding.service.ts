import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Brand } from 'src/entities/brand.entity';
import { CompanySettings } from 'src/entities/company-settings.entity';
import { BrandTokens, DEFAULT_BRAND_TOKENS } from './documents.types';

@Injectable()
export class BrandingService {
  private readonly logger = new Logger(BrandingService.name);
  private cache: BrandTokens | null = null;

  constructor(
    @InjectRepository(Brand) private readonly repo: Repository<Brand>,
    // FUENTE ÚNICA de datos fiscales/contacto: `company_settings` (antes se duplicaban
    // en brand.fiscal/brand.contact). `brand` conserva SOLO la identidad visual.
    @InjectRepository(CompanySettings) private readonly companyRepo: Repository<CompanySettings>,
  ) {}

  async getTokens(): Promise<BrandTokens> {
    if (this.cache) return this.cache;
    let row: Brand | null = null;
    let company: CompanySettings | null = null;
    try {
      row = await this.repo.findOne({ where: { key: 'default' } });
    } catch (e: any) {
      this.logger?.warn(`no se pudo leer branding, usando defaults: ${e?.message}`);
    }
    try {
      company = await this.companyRepo.findOne({ where: {}, order: { id: 'ASC' } });
    } catch (e: any) {
      this.logger?.warn(`no se pudo leer company_settings, usando defaults: ${e?.message}`);
    }
    const d = DEFAULT_BRAND_TOKENS;
    // Mapeo company_settings → tokens fiscal/contact (mantiene la forma que consumen
    // las plantillas: {{brand.fiscal.razonSocial}}, {{brand.contact.website}}, …).
    const fiscalFromCompany = {
      ...(company?.name ? { razonSocial: company.name } : {}),
      ...(company?.taxId ? { rfc: company.taxId } : {}),
      ...(company?.address ? { direccion: company.address } : {}),
    };
    const contactFromCompany = {
      ...(company?.phone ? { phone: company.phone } : {}),
      ...(company?.email ? { email: company.email } : {}),
      ...(company?.website ? { website: company.website } : {}),
    };
    this.cache = {
      logoLight: row?.logoLight ?? d.logoLight,
      logoDark: row?.logoDark ?? d.logoDark,
      colors: { ...d.colors, ...(row?.colors ?? {}) },
      typography: { ...d.typography, ...(row?.typography ?? {}) },
      borderRadius: row?.borderRadius ?? d.borderRadius,
      fiscal: { ...d.fiscal, ...fiscalFromCompany },
      contact: { ...d.contact, ...contactFromCompany },
      social: { ...d.social, ...(row?.social ?? {}) },
    };
    return this.cache;
  }

  invalidate(): void {
    this.cache = null;
  }
}

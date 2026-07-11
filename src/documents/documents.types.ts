import { BrandColors, BrandContact, BrandFiscal, BrandSocial, BrandTypography } from 'src/entities/brand.entity';

export interface BrandTokens {
  logoLight: string | null;
  logoDark: string | null;
  colors: Required<BrandColors>;
  typography: Required<BrandTypography>;
  borderRadius: string;
  fiscal: BrandFiscal;
  contact: BrandContact;
  social: BrandSocial;
}

/** Valores por defecto seguros para que un render NUNCA falle por branding vacío. */
export const DEFAULT_BRAND_TOKENS: BrandTokens = {
  logoLight: null,
  logoDark: null,
  colors: { primary: '#3498db', secondary: '#2c3e50', button: '#2980b9', text: '#2c3e50', background: '#ffffff' },
  typography: { fontFamily: 'Arial, sans-serif', baseSize: '14px' },
  borderRadius: '8px',
  fiscal: {},
  contact: { website: 'https://app-pmy.vercel.app/' },
  social: {},
};

export interface RenderContext {
  data: Record<string, any>;
  brand: BrandTokens;
  system: { now: Date; appUrl: string; env: string };
}

import { DocumentFormat } from 'src/entities/document-template.entity';

export interface RenderResult {
  format: DocumentFormat;
  mime: string;
  filename?: string;
  html?: string;
  subject?: string;
  buffer?: Buffer;
}

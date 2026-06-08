export interface PostalCodeItem {
  d_codigo: string;
  d_estado: string;
  d_ciudad: string;
  d_asenta: string;
  D_mnpio: string;
  d_tipo_asenta: string;
}

export interface PostalCodeResponse {
  meta: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
  };
  data: PostalCodeItem[];
}
import { ValueTransformer } from 'typeorm';

/** MySQL devuelve DECIMAL como string; esto lo expone como number (o null). */
export const decimalTransformer: ValueTransformer = {
  to: (v: number | null | undefined) => v,
  from: (v: string | number | null) => (v === null || v === undefined ? null : Number(v)),
};

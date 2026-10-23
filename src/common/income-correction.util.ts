/**
 * "Corrección" = ingreso que se agregó a mano o se editó en el Consolidador (o por una acción
 * autorizada sobre un consolidado). Todos esos caminos dejan `editReason` (motivo obligatorio),
 * así que no hace falta una columna aparte y los históricos ya quedan marcados.
 */
export interface CorrectionLike {
  editReason?: string | null;
  updatedById?: string | null;
  createdById?: string | null;
  originalCost?: number | string | null;
  updatedAt?: Date | string | null;
  createdAt?: Date | string | null;
}

export type CorrectionKind = 'agregado' | 'editado';

export function isCorrectionIncome(i: CorrectionLike): boolean {
  return !!String(i.editReason ?? '').trim();
}

/** Editado si alguien lo ajustó después de creado; agregado si nació a mano con su motivo. */
export function correctionKind(i: CorrectionLike): CorrectionKind {
  return i.updatedById || i.originalCost != null ? 'editado' : 'agregado';
}

/** Usuario responsable de la corrección: el del último ajuste o, si nació a mano, quien lo creó. */
export function correctionAuthorId(i: CorrectionLike): string | null {
  return i.updatedById || i.createdById || null;
}

/** Cuándo se hizo la corrección. */
export function correctionAt(i: CorrectionLike): Date | null {
  const v = correctionKind(i) === 'editado' ? i.updatedAt : i.createdAt;
  return v ? new Date(v) : null;
}

import { normalize } from './text-normalize.util';
import { GENERIC_TERMS, stationCodes } from './detector';
import { AliasSignalType } from './inbox.types';

/**
 * Qué pistas aprende el sistema cuando alguien confirma la sucursal de un correo:
 * remitente, copias, códigos de estación y palabras del asunto. Cada pista suma un
 * acierto a la sucursal confirmada y un error a las demás sucursales que la tenían.
 */

export interface LearnInput {
  fromAddress: string;
  cc: string[];
  subject: string;
  filenames: string[];
  /** Dominios propios: sus direcciones no son pista (todos los correos los traen). */
  ownDomains: string[];
}

export interface LearnedTerm {
  signalType: AliasSignalType;
  term: string;
}

function isOwn(addr: string, ownDomains: string[]): boolean {
  const d = (addr.split('@')[1] ?? '').toLowerCase();
  return ownDomains.some((o) => d === o || d.endsWith(`.${o}`));
}

export function subjectTerms(subject: string): string[] {
  return [...new Set(normalize(subject).split(' ').filter((w) => w.length >= 3 && !/\d/.test(w) && !GENERIC_TERMS.has(w)))];
}

export function computeLearning(i: LearnInput): LearnedTerm[] {
  const out: LearnedTerm[] = [];
  const push = (signalType: AliasSignalType, term: string) => {
    if (term && !out.some((o) => o.signalType === signalType && o.term === term)) out.push({ signalType, term });
  };
  if (i.fromAddress && !isOwn(i.fromAddress, i.ownDomains)) push('remitente', i.fromAddress.toLowerCase());
  for (const cc of i.cc) if (cc && !isOwn(cc, i.ownDomains)) push('copia', cc.toLowerCase());
  for (const code of stationCodes(i.subject, i.filenames)) push('estacion', code);
  for (const t of subjectTerms(i.subject)) push('termino', t);
  return out;
}

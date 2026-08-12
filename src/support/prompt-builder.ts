/**
 * Generador determinista de prompts para IA a partir de un ticket de soporte.
 * Lógica pura (sin Nest/TypeORM/disco): recibe el ticket + el contexto de código
 * ya resuelto por `code-locator` y ensambla un prompt en secciones. Cero costo de
 * API y reproducible: el mismo ticket + mismo grafo → el mismo prompt.
 */

/** Verbo/objetivo por tipo de ticket. */
const INTENT_BY_TYPE: Record<string, string> = {
  mejora: 'Implementar la siguiente mejora',
  cambio: 'Modificar el comportamiento existente',
  eliminar: 'Eliminar del sistema lo siguiente',
  error: 'Corregir el siguiente bug',
};

/** Criterios de aceptación base por tipo (además de los transversales). */
const ACCEPTANCE_BY_TYPE: Record<string, string[]> = {
  mejora: ['La nueva función queda disponible en la ubicación indicada y sigue los patrones del módulo.'],
  cambio: ['El comportamiento cambia según lo pedido sin romper los flujos vecinos.'],
  eliminar: ['Se elimina lo indicado y sus referencias/imports muertos; nada más deja de compilar.'],
  error: [
    'El bug ya no se reproduce siguiendo los pasos descritos.',
    'Se agrega o ajusta una prueba que cubra el caso.',
  ],
};

export interface PromptTicketInput {
  folio: string;
  tipo: string;
  titulo: string;
  descripcion: string;
  pasosReplicar?: string | null;
  menuPrincipal?: string | null;
  submenu?: string | null;
  seccion?: string | null;
  subseccion?: string | null;
  nuevoMenu?: string | null;
  menuError?: string | null;
  submenuError?: string | null;
  route?: string | null;
  appVersion?: string | null;
  imagenes?: { url: string }[];
}

export type CodeConfidence = 'alta' | 'media' | 'ninguna';

export interface CodeContext {
  repo: string | null;
  files: string[];
  components: string[];
  confidence: CodeConfidence;
}

export interface BuildPromptArgs {
  ticket: PromptTicketInput;
  codeContext: CodeContext;
}

function tipoLabel(tipo: string): string {
  return INTENT_BY_TYPE[tipo] ? tipo.charAt(0).toUpperCase() + tipo.slice(1) : tipo;
}

/** "operaciones › consolidados" a partir de los campos de ubicación. */
function locationTrail(t: PromptTicketInput): string[] {
  const lines: string[] = [];
  const menuTrail = [t.menuPrincipal, t.submenu].filter(Boolean).join(' › ');
  const seccionTrail = [t.seccion, t.subseccion].filter(Boolean).join(' › ');
  if (menuTrail) lines.push(`- Menú: ${menuTrail}`);
  if (seccionTrail) lines.push(`- Sección: ${seccionTrail}`);
  if (t.nuevoMenu) lines.push(`- Menú nuevo propuesto: ${t.nuevoMenu}`);
  const errTrail = [t.menuError, t.submenuError].filter(Boolean).join(' › ');
  if (errTrail) lines.push(`- Ubicación del error: ${errTrail}`);
  if (t.route) lines.push(`- Ruta: ${t.route}`);
  if (t.appVersion) lines.push(`- Versión de la app: ${t.appVersion}`);
  return lines;
}

const CONFIDENCE_NOTE: Record<CodeConfidence, string> = {
  alta: 'Candidatos derivados de la ruta exacta en el grafo. Verificar antes de editar.',
  media: 'Candidatos por coincidencia de palabra clave (no ruta exacta). Verificar antes de editar.',
  ninguna: 'El grafo no ubicó archivos; usar la ubicación de arriba para localizar el código.',
};

/**
 * Ensambla el prompt final. Omite secciones vacías para no ensuciar el resultado.
 */
export function buildPrompt({ ticket: t, codeContext: cc }: BuildPromptArgs): string {
  const parts: string[] = [];

  parts.push(`# Tarea de soporte ${t.folio} — ${tipoLabel(t.tipo)}`);

  const intent = INTENT_BY_TYPE[t.tipo] ?? 'Atender la siguiente solicitud';
  parts.push(`## Objetivo\n${intent}: ${t.titulo}`);

  parts.push(`## Descripción del usuario\n${t.descripcion.trim()}`);

  if (t.pasosReplicar?.trim()) {
    parts.push(`## Pasos para reproducir\n${t.pasosReplicar.trim()}`);
  }

  const loc = locationTrail(t);
  if (loc.length) parts.push(`## Ubicación en la app\n${loc.join('\n')}`);

  // Contexto de código
  const ctxLines: string[] = [];
  if (cc.repo) ctxLines.push(`Repositorio: ${cc.repo}`);
  if (cc.files.length) {
    ctxLines.push('Archivos probables:');
    for (const f of cc.files) ctxLines.push(`- ${f}`);
  }
  if (cc.components.length) {
    ctxLines.push(`Componentes: ${cc.components.join(', ')}`);
  }
  ctxLines.push(`(confianza: ${cc.confidence} — ${CONFIDENCE_NOTE[cc.confidence]})`);
  parts.push(`## Contexto de código\n${ctxLines.join('\n')}`);

  // Criterios de aceptación
  const acceptance = [
    ...(ACCEPTANCE_BY_TYPE[t.tipo] ?? []),
    'Seguir los patrones y el estilo del código existente en el repo.',
    'No romper flujos ni pruebas existentes.',
  ];
  parts.push(`## Criterios de aceptación\n${acceptance.map((a) => `- ${a}`).join('\n')}`);

  // Adjuntos
  const imgs = t.imagenes ?? [];
  if (imgs.length) {
    parts.push(
      `## Adjuntos\n${imgs.length} imagen(es) de referencia:\n${imgs.map((i) => `- ${i.url}`).join('\n')}`,
    );
  }

  return parts.join('\n\n');
}

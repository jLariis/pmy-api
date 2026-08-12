/**
 * Construye los mensajes para que DeepSeek **mejore** el prompt determinista
 * (que ya trae archivos/componentes reales del grafo). Lógica pura y testeable.
 * Regla clave: la IA pule redacción y accionabilidad, pero NO inventa rutas —
 * debe conservar exactamente los nombres de archivo/componente del borrador.
 */
import { ChatMessage } from '../ai/deepseek.service';

const SYSTEM = [
  'Eres un ingeniero de software senior que prepara tareas para un agente de IA de programación (Claude Code).',
  'Recibes un BORRADOR de prompt generado de forma determinista desde un ticket de soporte;',
  'ese borrador ya incluye contexto real del código (archivos y componentes tomados de un grafo del repo).',
  '',
  'Tu trabajo: reescribir el borrador como un prompt EXCELENTE y accionable, en español y en Markdown.',
  'Reglas estrictas:',
  '- CONSERVA textualmente los nombres de archivo, rutas y componentes del borrador. No inventes ni cambies rutas.',
  '- No agregues suposiciones sobre el código que no estén en el borrador; si algo es incierto, indícalo como "verificar".',
  '- Mantén/afina el objetivo, la descripción del usuario, los pasos, la ubicación, el contexto de código y los criterios de aceptación.',
  '- Sé conciso y directo. Devuelve ÚNICAMENTE el prompt final, sin comentarios previos ni explicaciones sobre lo que hiciste.',
].join('\n');

export function buildAiRefinementMessages(deterministicPrompt: string): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: `Mejora este borrador de prompt, respetando las reglas:\n\n---\n${deterministicPrompt}\n---`,
    },
  ];
}

/**
 * La dependencia `libsignal` (usada por Baileys) imprime por `console.*` CRUDO
 * —saltandose el logger pino de Baileys— la rotacion normal de sesiones E2E.
 * Ademas de ser ruido, uno de esos logs VUELCA EL OBJETO DE SESION COMPLETO,
 * incluyendo llaves privadas. Este filtro descarta SOLO esos mensajes.
 *
 * Defensa en profundidad: aunque `patch-package` neutraliza esos console.* en
 * la libreria, este filtro cubre el hueco antes de que corra el postinstall
 * (p.ej. un clone recien instalado) y cualquier variante futura del mensaje.
 *
 * Origen de los mensajes:
 *  - libsignal/src/session_builder.js  -> "Closing open session in favor of incoming prekey bundle"
 *  - libsignal/src/session_record.js   -> "Closing session:" / "Session already closed"
 */
const LIBSIGNAL_NOISE = [
  'Closing open session in favor of incoming prekey bundle',
  'Closing session:',
  'Session already closed',
];

/** True si el primer argumento del console.* es uno de los mensajes ruidosos de libsignal. */
export function isLibsignalNoise(args: unknown[]): boolean {
  const first = args?.[0];
  return typeof first === 'string' && LIBSIGNAL_NOISE.some((m) => first.startsWith(m));
}

let installed = false;

/** Envuelve console.info/console.warn una sola vez para descartar el ruido de libsignal.
 *  Idempotente: llamarlo varias veces no encadena wrappers. */
export function installLibsignalConsoleFilter(): void {
  if (installed) return;
  installed = true;
  (['info', 'warn'] as const).forEach((method) => {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      if (isLibsignalNoise(args)) return;
      original(...args);
    };
  });
}

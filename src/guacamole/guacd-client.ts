import { Socket } from 'net';
import { EventEmitter } from 'events';
import { StringDecoder } from 'string_decoder';

export type GuacProtocol = 'vnc' | 'rdp' | 'ssh' | 'telnet';

export interface GuacdClientOptions {
  guacdHost: string;
  guacdPort: number;
  protocol: GuacProtocol;
  /** Args del `connect` por NOMBRE (hostname, port, username, password, security, ...). */
  settings: Record<string, string>;
  width: number;
  height: number;
  dpi: number;
  audioMimetypes?: string[];
  videoMimetypes?: string[];
  imageMimetypes?: string[];
  timezone?: string;
}

/** Formatea una instrucción Guacamole: `4.size,4.1024,3.768,2.96;` (longitud = code-points). */
function fmt(...elements: (string | number)[]): string {
  return (
    elements
      .map((e) => {
        const s = String(e);
        return `${Array.from(s).length}.${s}`;
      })
      .join(',') + ';'
  );
}

/** Parser incremental SOLO para el handshake (contenido ASCII → índices UTF-16 exactos). */
class HandshakeParser {
  private buf = '';

  push(chunk: string): string[][] {
    this.buf += chunk;
    const out: string[][] = [];
    let cursor = 0;
    for (;;) {
      const parsed = this.parseOne(cursor);
      if (!parsed) break;
      out.push(parsed.elements);
      cursor = parsed.next;
    }
    this.buf = this.buf.slice(cursor);
    return out;
  }

  /** Lo que quedó sin parsear (bytes post-handshake) para arrancar el streaming. */
  drain(): string {
    const rest = this.buf;
    this.buf = '';
    return rest;
  }

  private parseOne(start: number): { elements: string[]; next: number } | null {
    const elements: string[] = [];
    let i = start;
    for (;;) {
      const dot = this.buf.indexOf('.', i);
      if (dot === -1) return null;
      const len = Number.parseInt(this.buf.slice(i, dot), 10);
      if (Number.isNaN(len)) return null;
      const valStart = dot + 1;
      const valEnd = valStart + len;
      if (this.buf.length < valEnd + 1) return null; // falta valor + terminador
      elements.push(this.buf.slice(valStart, valEnd));
      const term = this.buf[valEnd];
      i = valEnd + 1;
      if (term === ';') return { elements, next: i };
      if (term !== ',') return null; // malformado
    }
  }
}

/**
 * Túnel de bajo nivel a guacd. Hace el handshake (select → args → connect → ready)
 * y luego emite/recibe el stream crudo (texto) hacia el WebSocket.
 * Eventos: 'ready' | 'data'(text) | 'error'(Error) | 'close'.
 */
export class GuacdClient extends EventEmitter {
  private socket?: Socket;
  private readonly decoder = new StringDecoder('utf8');
  private readonly parser = new HandshakeParser();
  private handshakeDone = false;
  private argsReceived = false;

  constructor(private readonly opts: GuacdClientOptions) {
    super();
  }

  connect(): void {
    const socket = new Socket();
    this.socket = socket;
    socket.setNoDelay(true);
    socket.setTimeout(15_000, () => {
      if (!this.handshakeDone) this.emit('error', new Error('guacd handshake timeout'));
    });
    socket.on('connect', () => {
      socket.setTimeout(0);
      this.write(fmt('select', this.opts.protocol)); // paso 1
    });
    socket.on('data', (chunk) => this.onData(chunk));
    socket.on('error', (e) => this.emit('error', e));
    socket.on('close', () => this.emit('close'));
    socket.connect(this.opts.guacdPort, this.opts.guacdHost);
  }

  private onData(chunk: Buffer): void {
    const text = this.decoder.write(chunk);
    if (this.handshakeDone) {
      if (text) this.emit('data', text);
      return;
    }
    for (const el of this.parser.push(text)) {
      if (el[0] === 'args' && !this.argsReceived) {
        this.argsReceived = true;
        this.completeHandshake(el.slice(1));
      }
    }
    if (this.handshakeDone) {
      const leftover = this.parser.drain(); // por si guacd ya mandó parte del stream
      if (leftover) this.emit('data', leftover);
    }
  }

  private completeHandshake(argNames: string[]): void {
    const o = this.opts;
    this.write(fmt('size', o.width, o.height, o.dpi));
    this.write(fmt('audio', ...(o.audioMimetypes ?? [])));
    this.write(fmt('video', ...(o.videoMimetypes ?? [])));
    this.write(fmt('image', ...(o.imageMimetypes ?? ['image/png', 'image/jpeg', 'image/webp'])));
    this.write(fmt('timezone', o.timezone ?? 'America/Hermosillo'));

    // `connect` DEBE responder un valor por cada arg en el ORDEN recibido.
    // Los tokens VERSION_* se hacen eco; el resto se resuelve por nombre.
    const values = argNames.map((name) =>
      name.startsWith('VERSION_') ? name : (o.settings[name] ?? ''),
    );
    this.write(fmt('connect', ...values));

    this.handshakeDone = true;
    this.emit('ready');
  }

  /** Cliente → guacd (ya viene como texto del protocolo). */
  send(data: string): void {
    this.write(data);
  }

  private write(data: string): void {
    if (this.socket && !this.socket.destroyed) this.socket.write(data, 'utf8');
  }

  close(): void {
    this.socket?.destroy();
    this.socket = undefined;
  }
}

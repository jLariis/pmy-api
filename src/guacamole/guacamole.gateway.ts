import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { IncomingMessage, Server } from 'http';
import type { Duplex } from 'stream';
import { RawData, WebSocket, WebSocketServer } from 'ws';
import { GuacdClient } from './guacd-client';
import { decryptConnectionToken } from './connection-token.util';

const WS_PATH = '/ws/guacamole';

/**
 * El evento `upgrade` del servidor HTTP raw NO pasa por `setGlobalPrefix('api')`,
 * así que `req.url` llega tal cual lo manda el cliente. El frontend usa la misma
 * baseURL del API (con `/api`), por lo que aquí aceptamos AMBAS variantes:
 * `/ws/guacamole` y `/api/ws/guacamole`. Robusto ante que nginx reenvíe con o sin prefijo.
 */
function isGuacamolePath(pathname: string): boolean {
  const normalized = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  return normalized === WS_PATH || normalized.endsWith(WS_PATH);
}
const SUPERADMIN_ROLES = ['superadmin', 'superamin']; // variante histórica

/**
 * Túnel WebSocket transparente entre el navegador (guacamole-common-js) y guacd.
 * WS CRUDO (no socket.io): guacamole-common-js habla el protocolo Guacamole en
 * frames de texto. EXCLUSIVO superadmin: el rol se valida en el handshake porque
 * el upgrade NO pasa por los guards de Nest.
 */
@Injectable()
export class GuacamoleGateway implements OnModuleInit {
  private readonly logger = new Logger(GuacamoleGateway.name);
  private wss!: WebSocketServer;

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly jwt: JwtService,
  ) {}

  onModuleInit(): void {
    const server: Server = this.adapterHost.httpAdapter.getHttpServer();
    this.wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      let pathname = '';
      try {
        pathname = new URL(req.url ?? '', 'http://localhost').pathname;
      } catch {
        return;
      }

      if (!isGuacamolePath(pathname)) {
        // No es nuestra ruta, ignoramos en silencio
        return;
      }

      // ¡Aquí atrapamos si la petición sí está llegando al gateway!
      // Si este log NO aparece en producción, el upgrade muere en nginx
      // (falta `proxy_set_header Upgrade`/`Connection` en el location de /api).
      this.logger.log(`[Upgrade] Petición WS entrante interceptada: ${req.url}`);

      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.wss.emit('connection', ws, req);
      });
    });

    this.wss.on('connection', (ws, req) => void this.handleConnection(ws, req));
    this.logger.log(`Túnel Guacamole (superadmin) escuchando en ${WS_PATH}`);
  }

  private async handleConnection(ws: WebSocket, req: IncomingMessage): Promise<void> {
    const q = new URL(req.url ?? '', 'http://localhost').searchParams;

    // 1) AUTENTICACIÓN + AUTORIZACIÓN (SOLO superadmin) — antes de tocar guacd.
    try {
      const payload: any = await this.jwt.verifyAsync(q.get('token') ?? '');
      const role = String(payload?.role ?? '').toLowerCase();
      if (!SUPERADMIN_ROLES.includes(role)) {
        this.logger.warn(`Acceso remoto DENEGADO user=${payload?.sub} role=${role}`);
        ws.close(4403, 'forbidden');
        return;
      }
      this.logger.log(`Sesión remota (superadmin) user=${payload?.sub}`);
    } catch {
      ws.close(4001, 'unauthorized');
      return;
    }

    // 2) CONFIG DE CONEXIÓN (protocolo + credenciales) desde el token cifrado.
    let conn;
    try {
      conn = decryptConnectionToken(q.get('connection') ?? '');
    } catch {
      ws.close(4002, 'invalid connection token');
      return;
    }

    const guacd = new GuacdClient({
      guacdHost: process.env.GUACD_HOST ?? '127.0.0.1',
      guacdPort: Number(process.env.GUACD_PORT ?? 4822),
      protocol: conn.protocol,
      settings: conn.settings,
      width: Number(q.get('width') ?? 1024),
      height: Number(q.get('height') ?? 768),
      dpi: Number(q.get('dpi') ?? 96),
      audioMimetypes: ['audio/L16;rate=44100,channels=2'],
      imageMimetypes: ['image/png', 'image/jpeg', 'image/webp'],
      timezone: q.get('timezone') ?? 'America/Hermosillo',
    });

    // Buffer cliente→guacd hasta que termine el handshake (no perder instrucciones tempranas).
    let ready = false;
    const pending: string[] = [];

    const safeClose = (code?: number, reason?: string) => {
      guacd.close();
      if (ws.readyState === WebSocket.OPEN) ws.close(code, reason);
    };

    guacd.on('ready', () => {
      ready = true;
      for (const m of pending) guacd.send(m);
      pending.length = 0;
    });
    guacd.on('data', (text: string) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(text);
    });
    guacd.on('error', (e: Error) => {
      this.logger.error(`guacd error: ${e.message}`);
      safeClose(4003, 'guacd error'); // graceful degradation → el cliente reintenta
    });
    guacd.on('close', () => safeClose(1000, 'guacd closed'));

    ws.on('message', (data: RawData) => {
      const msg = data.toString('utf8');
      if (ready) guacd.send(msg);
      else pending.push(msg);
    });
    ws.on('close', () => guacd.close());
    ws.on('error', () => guacd.close());

    guacd.connect();
  }
}

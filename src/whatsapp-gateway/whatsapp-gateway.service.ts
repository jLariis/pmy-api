import { Injectable, Logger, OnModuleInit, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as QRCode from 'qrcode';

export type WaStatus = 'disconnected' | 'connecting' | 'qr' | 'connected';

/**
 * Gateway de WhatsApp AUTO-HOSPEDADO (Baileys). El servidor se vuelve un
 * "dispositivo vinculado" de una cuenta de WhatsApp: se escanea un QR UNA vez
 * desde Configuración y a partir de ahí la API envía mensajes sola — sin abrir
 * WhatsApp en la PC, sin web.whatsapp.com, sin APIs de terceros ni costo.
 *
 * OJO (riesgo asumido): es una integración NO oficial (contra los ToS de
 * WhatsApp); el número vinculado puede ser bloqueado. Usar un número dedicado.
 *
 * Baileys 7 es ESM puro y Nest compila a CommonJS, por eso se carga con
 * `import()` dinámico real (truco `new Function`) — un `import`/`require`
 * estático tronaría con ERR_REQUIRE_ESM al ejecutar.
 */
@Injectable()
export class WhatsappGatewayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsappGatewayService.name);
  private readonly authDir = path.join(process.cwd(), 'whatsapp-session');

  private baileys: any = null;
  private waLogger: any = null;
  private sock: any = null;
  private status: WaStatus = 'disconnected';
  private qrDataUrl: string | null = null;
  private meNumber: string | null = null;
  private lastError: string | null = null;
  private starting = false;

  async onModuleInit() {
    // Reconecta solo si ya hay una sesión guardada (no forzamos QR al arrancar).
    if (fs.existsSync(path.join(this.authDir, 'creds.json'))) {
      this.start().catch((e) => this.logger.warn(`No se pudo reconectar WhatsApp al iniciar: ${e?.message}`));
    }
  }

  onModuleDestroy() {
    try { this.sock?.end?.(undefined); } catch { /* noop */ }
  }

  /** Carga Baileys (ESM) de forma dinámica sin que TS lo convierta a require(). */
  private async loadBaileys() {
    if (!this.baileys) {
      const dynamicImport = new Function('m', 'return import(m)');
      this.baileys = await dynamicImport('@whiskeysockets/baileys');
      // Logger pino en nivel 'warn' para ver errores internos de Baileys en la
      // consola del servidor (clave para diagnosticar fallos de emparejamiento).
      try {
        const pino = (await dynamicImport('pino')).default;
        this.waLogger = pino({ level: process.env.WHATSAPP_LOG_LEVEL || 'warn' });
      } catch { this.waLogger = undefined; }
    }
    return this.baileys;
  }

  /** Abre (o reabre) el socket. Idempotente: no duplica conexiones. */
  private async start() {
    if (this.starting || this.status === 'connected') return;
    this.starting = true;
    try {
      const b = await this.loadBaileys();
      const makeWASocket = b.default ?? b.makeWASocket;
      const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = b;

      const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

      // Versión del protocolo de WhatsApp Web. Si no se obtiene la actual, el
      // teléfono rechaza el emparejamiento con "Revisa tu conexión". Por eso se
      // intenta traer la última y se LOGGEA cuál se usó.
      let version: any = undefined;
      try {
        const res = await fetchLatestBaileysVersion();
        version = res?.version;
        this.logger.log(`WhatsApp Web version: ${JSON.stringify(version)} (isLatest: ${res?.isLatest})`);
      } catch (e: any) {
        this.logger.warn(`No se pudo obtener la última versión de WhatsApp Web (se usa la de la librería): ${e?.message}`);
      }

      const browser = Browsers?.ubuntu ? Browsers.ubuntu('Chrome') : ['PMY Monitor', 'Chrome', '120.0.0'];

      this.status = 'connecting';
      this.lastError = null;
      this.sock = makeWASocket({
        version,
        auth: state,
        browser,
        logger: this.waLogger,
        markOnlineOnConnect: false,
        syncFullHistory: false,
      });

      this.sock.ev.on('creds.update', saveCreds);
      this.sock.ev.on('connection.update', async (u: any) => {
        const { connection, lastDisconnect, qr } = u;
        const code = (lastDisconnect?.error as any)?.output?.statusCode;
        this.logger.log(`connection.update → conn=${connection ?? '—'} qr=${qr ? 'sí' : 'no'} code=${code ?? '—'}`);

        if (qr) {
          this.status = 'qr';
          this.qrDataUrl = await QRCode.toDataURL(qr).catch(() => null);
          this.logger.log('QR generado — escanéalo desde WhatsApp → Dispositivos vinculados.');
        }

        if (connection === 'open') {
          this.status = 'connected';
          this.qrDataUrl = null;
          this.lastError = null;
          this.meNumber = String(this.sock?.user?.id || '').split(':')[0].split('@')[0] || null;
          this.logger.log(`WhatsApp CONECTADO como ${this.meNumber}`);
        }

        if (connection === 'close') {
          const reason = (lastDisconnect?.error as any)?.message || String(code || 'desconocido');
          this.lastError = reason;
          this.sock = null;
          this.starting = false;

          if (code === DisconnectReason.loggedOut) {
            // Se desvinculó desde el teléfono: limpiar sesión y quedar fuera.
            this.logger.warn('WhatsApp desvinculado (loggedOut). Se limpia la sesión.');
            this.status = 'disconnected';
            this.qrDataUrl = null;
            this.meNumber = null;
            await this.clearSession();
          } else if (code === DisconnectReason.restartRequired) {
            // NORMAL justo después de escanear el QR: hay que reabrir el socket
            // de inmediato para completar el login con las credenciales nuevas.
            this.logger.log('restartRequired (515) — reabriendo socket para completar el emparejamiento…');
            this.status = 'connecting';
            setTimeout(() => this.start().catch((e) => this.logger.warn(`Reinicio falló: ${e?.message}`)), 500);
          } else {
            // Caída temporal (timeout, red, etc.): reintentar con un respiro.
            this.logger.warn(`Conexión cerrada (code=${code}, ${reason}). Reintentando en 3s…`);
            this.status = 'connecting';
            setTimeout(() => this.start().catch((e) => this.logger.warn(`Reintento falló: ${e?.message}`)), 3000);
          }
        }
      });
    } catch (e: any) {
      this.lastError = e?.message || 'error desconocido';
      this.status = 'disconnected';
      this.logger.error(`Fallo al iniciar WhatsApp: ${this.lastError}`);
    } finally {
      this.starting = false;
    }
  }

  getStatus() {
    return { status: this.status, qr: this.qrDataUrl, me: this.meNumber, lastError: this.lastError };
  }

  /**
   * Inicia la vinculación desde cero: limpia cualquier sesión previa (parcial o
   * corrupta de intentos fallidos) para forzar un QR nuevo y limpio.
   */
  async link() {
    if (this.status === 'connected') return this.getStatus();
    try { this.sock?.end?.(undefined); } catch { /* noop */ }
    this.sock = null;
    this.starting = false;
    this.status = 'disconnected';
    this.qrDataUrl = null;
    this.meNumber = null;
    await this.clearSession();
    await this.start();
    return this.getStatus();
  }

  async logout() {
    try { await this.sock?.logout(); } catch { /* noop */ }
    try { this.sock?.end?.(undefined); } catch { /* noop */ }
    this.sock = null;
    this.status = 'disconnected';
    this.qrDataUrl = null;
    this.meNumber = null;
    await this.clearSession();
    return this.getStatus();
  }

  async sendText(toPhone: string, text: string) {
    if (this.status !== 'connected' || !this.sock) {
      throw new ServiceUnavailableException('WhatsApp no está conectado. Vincula un número en Configuración → WhatsApp.');
    }
    const digits = String(toPhone || '').replace(/\D/g, '');
    if (!digits) throw new ServiceUnavailableException('Número de destino inválido.');
    const jid = `${digits}@s.whatsapp.net`;
    await this.sock.sendMessage(jid, { text });
    return { ok: true, to: digits };
  }

  private async clearSession() {
    try { await fs.promises.rm(this.authDir, { recursive: true, force: true }); } catch { /* noop */ }
  }
}

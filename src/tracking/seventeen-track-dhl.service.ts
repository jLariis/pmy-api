import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import axios from 'axios';
import * as dayjs from 'dayjs';
import * as utc from 'dayjs/plugin/utc';
import * as timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

export interface TrackingRequestPayload {
  number: string;
  carrier: number;
}

export interface TrackEvent {
  time: string;
  description: string;
  location: string;
}

/**
 * Forma de la respuesta v2.4 de 17TRACK (POST .../track/v2.4/gettrackinfo).
 * OJO: en v2.4 cada item aceptado trae `track_info` (NO `track`), y el estatus
 * vive en `track_info.latest_status.status`; los eventos en
 * `track_info.tracking.providers[].events`.
 */
export interface V24LatestStatus {
  status: string;
  sub_status?: string;
}

export interface V24Event {
  time_iso?: string;
  time_utc?: string;
  description?: string;
  location?: string;
  address?: any;
}

export interface V24TrackInfo {
  latest_status?: V24LatestStatus;
  latest_event?: V24Event;
  tracking?: {
    providers?: Array<{ events?: V24Event[] }>;
  };
}

export interface V24AcceptedItem {
  number: string;
  carrier?: number;
  track_info?: V24TrackInfo;
}

export interface V24RejectedItem {
  number: string;
  error?: { code: number; message: string };
}

export interface TrackInfoApiResponse {
  code: number;
  data: {
    accepted: V24AcceptedItem[];
    rejected: V24RejectedItem[];
  };
}

export interface NormalizedTrackingResult {
  trackingNumber: string;
  currentStatus: string;
  subStatus: string | null;
  latestEvent: TrackEvent | null;
  localTimestamp: string;
  rawTrackingData: V24TrackInfo | null;
}

@Injectable()
export class SeventeenTrackDhlService {
  private readonly logger = new Logger(SeventeenTrackDhlService.name);
  private readonly apiKey = process.env.SEVENTEEN_TRACK_API_KEY || '';
  private readonly baseUrl = 'https://api.17track.net/track/v2.4';
  private readonly registerUrl = `${this.baseUrl}/register`;
  private readonly getTrackInfoUrl = `${this.baseUrl}/gettrackinfo`;
  private readonly deleteTrackUrl = `${this.baseUrl}/deletetrack`;
  /** Código de 17TRACK para "ya registrado" (NO consume quota; cuenta como registrado). */
  private readonly alreadyRegisteredCode = -18019901;
  private readonly localTimezone = 'America/Hermosillo';
  private readonly dhlCarrierCode = 100001;
  /** 17TRACK acepta máximo 40 números por request. */
  private readonly maxBatchSize = 40;
  /**
   * Tras registrar, 17TRACK busca con la paquetería de forma ASÍNCRONA; la 1ª
   * consulta puede devolver -18019909 ("no tracking information at this time").
   * Reintentamos solo las guías pendientes, acotado para no colgar el request.
   */
  private readonly pendingErrorCode = -18019909;
  private readonly maxGetAttempts = 3;
  private readonly retryDelayMs = 2500;

  private get headers() {
    return { '17token': this.apiKey, 'Content-Type': 'application/json' };
  }

  /**
   * Consulta estatus en 17TRACK. Por defecto registra primero (necesario para
   * guías nuevas). En el cron de RECICLAJE, las guías ya vienen registradas, así
   * que se llama con `{ skipRegister: true }` para NO gastar llamadas/quota.
   */
  public async fetchTrackingStatuses(
    trackingNumbers: string[],
    opts: { skipRegister?: boolean } = {},
  ): Promise<NormalizedTrackingResult[]> {
    const currentLocalTime = dayjs().tz(this.localTimezone).format('YYYY-MM-DD HH:mm:ss');

    if (!this.apiKey) {
      this.logger.error('Falta SEVENTEEN_TRACK_API_KEY en el entorno.');
      throw new HttpException(
        'Configuración faltante: SEVENTEEN_TRACK_API_KEY no está definida.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const numbers = (trackingNumbers || []).map((n) => `${n}`.trim()).filter(Boolean);
    if (numbers.length === 0) return [];

    this.logger.log(`Consultando ${numbers.length} guías DHL en 17TRACK (${currentLocalTime}).`);

    const results: NormalizedTrackingResult[] = [];

    for (const batch of this.chunk(numbers, this.maxBatchSize)) {
      // 1) Registrar los números (salvo skipRegister). 17TRACK SOLO devuelve datos
      //    de números ya registrados; sin este paso `gettrackinfo` los rechaza.
      if (!opts.skipRegister) await this.registerNumbers(batch);

      // 2) Obtener la info, reintentando SOLO las guías que sigan "pendientes"
      //    (búsqueda asíncrona de 17TRACK aún sin completar).
      const acceptedByNumber = new Map<string, V24AcceptedItem>();
      let pending = [...batch];

      for (let attempt = 1; attempt <= this.maxGetAttempts && pending.length > 0; attempt++) {
        if (attempt > 1) {
          this.logger.log(`17TRACK: reintento ${attempt}/${this.maxGetAttempts} para ${pending.length} guía(s) pendiente(s) tras ${this.retryDelayMs}ms.`);
          await this.sleep(this.retryDelayMs);
        }

        const { accepted, rejected } = await this.getTrackInfo(pending);
        for (const item of accepted) acceptedByNumber.set(item.number, item);

        // Pendientes = rechazos con el código de "aún sin información" (reintetan).
        const stillPending = rejected.filter((r) => r.error?.code === this.pendingErrorCode).map((r) => r.number);
        // Rechazos permanentes (número inválido, etc.): se loguean y no se reintentan.
        const permanent = rejected.filter((r) => r.error?.code !== this.pendingErrorCode);
        if (permanent.length > 0) {
          this.logger.warn(
            `17TRACK rechazó (permanente) ${permanent.length} guía(s): ${permanent
              .map((r) => `${r.number}(${r.error?.code}:${r.error?.message})`)
              .join(', ')}`,
          );
        }
        pending = stillPending;
      }

      if (pending.length > 0) {
        this.logger.warn(
          `17TRACK: ${pending.length} guía(s) sin datos tras ${this.maxGetAttempts} intento(s) (recién registradas; 17TRACK aún las consulta): ${pending.join(', ')}`,
        );
      }

      for (const item of acceptedByNumber.values()) {
        results.push(this.normalize(item, currentLocalTime));
      }
    }

    this.logger.log(`17TRACK: normalizadas ${results.length}/${numbers.length} guías DHL.`);
    return results;
  }

  /** Una llamada a gettrackinfo; valida code 0 y devuelve accepted/rejected. */
  private async getTrackInfo(numbers: string[]): Promise<{ accepted: V24AcceptedItem[]; rejected: V24RejectedItem[] }> {
    const payload: TrackingRequestPayload[] = numbers.map((number) => ({ number, carrier: this.dhlCarrierCode }));

    let response;
    try {
      response = await axios.post<TrackInfoApiResponse>(this.getTrackInfoUrl, payload, { headers: this.headers });
    } catch (error: any) {
      this.logger.error(
        `Error consultando 17TRACK (gettrackinfo): ${error?.message}. Respuesta: ${JSON.stringify(error?.response?.data)}`,
      );
      throw new HttpException(
        'No se pudo conectar con 17TRACK para consultar estatus de DHL.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const body = response.data;
    if (!body || body.code !== 0) {
      this.logger.error(`17TRACK devolvió code=${body?.code}. Respuesta: ${JSON.stringify(body)}`);
      throw new HttpException(
        `17TRACK devolvió un código de error (${body?.code ?? 'desconocido'}).`,
        HttpStatus.BAD_GATEWAY,
      );
    }

    return { accepted: body.data?.accepted ?? [], rejected: body.data?.rejected ?? [] };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Consulta la QUOTA real de la cuenta 17TRACK (para mostrarla en Configuración
   * sin entrar a 17track). Devuelve total/usada/restante y consumo del día.
   */
  public async getQuota(): Promise<{
    total: number;
    used: number;
    remaining: number;
    todayUsed: number;
  }> {
    if (!this.apiKey) {
      throw new HttpException('SEVENTEEN_TRACK_API_KEY no está definida.', HttpStatus.INTERNAL_SERVER_ERROR);
    }
    try {
      const { data } = await axios.post(`${this.baseUrl}/getquota`, {}, { headers: this.headers });
      const d = data?.data ?? {};
      return {
        total: d.quota_total ?? 0,
        used: d.quota_used ?? 0,
        remaining: d.quota_remain ?? 0,
        todayUsed: d.today_used ?? 0,
      };
    } catch (error: any) {
      this.logger.error(`Error consultando quota 17TRACK: ${error?.message}. ${JSON.stringify(error?.response?.data)}`);
      throw new HttpException('No se pudo consultar la quota de 17TRACK.', HttpStatus.BAD_GATEWAY);
    }
  }

  /**
   * Registra números en 17TRACK (consume 1 quota por número NUEVO). Devuelve qué
   * quedó registrado (aceptados + los que ya estaban) y cuáles fallaron de forma
   * permanente. No lanza. Respeta el límite de 40 por request (chunking).
   */
  public async registerNumbers(numbers: string[]): Promise<{ registered: string[]; failed: string[] }> {
    const clean = (numbers || []).map((n) => `${n}`.trim()).filter(Boolean);
    const registered: string[] = [];
    const failed: string[] = [];

    for (const batch of this.chunk(clean, this.maxBatchSize)) {
      const payload: TrackingRequestPayload[] = batch.map((number) => ({ number, carrier: this.dhlCarrierCode }));
      try {
        const { data } = await axios.post<TrackInfoApiResponse>(this.registerUrl, payload, { headers: this.headers });
        const accepted = (data?.data?.accepted ?? []).map((a) => a.number);
        const rejected = data?.data?.rejected ?? [];
        registered.push(...accepted);
        for (const r of rejected) {
          // "Ya registrado" cuenta como registrado (no gastó quota nueva).
          if (r.error?.code === this.alreadyRegisteredCode) registered.push(r.number);
          else failed.push(r.number);
        }
        if (rejected.length > 0) {
          this.logger.debug(
            `17TRACK register: ${rejected.length} rechazado(s): ${rejected
              .map((r) => `${r.number}(${r.error?.code})`)
              .join(', ')}`,
          );
        }
      } catch (error: any) {
        // No fatal: marcamos como fallidos para reintentar en otra corrida.
        failed.push(...batch);
        this.logger.warn(`17TRACK register falló: ${error?.message}. ${JSON.stringify(error?.response?.data)}`);
      }
    }

    return { registered, failed };
  }

  /**
   * Borra números de 17TRACK (deletetrack) para LIBERAR quota tras llegar a un
   * estatus terminal. Devuelve los borrados. No lanza.
   */
  public async deleteNumbers(numbers: string[]): Promise<{ deleted: string[] }> {
    const clean = (numbers || []).map((n) => `${n}`.trim()).filter(Boolean);
    const deleted: string[] = [];

    for (const batch of this.chunk(clean, this.maxBatchSize)) {
      const payload: TrackingRequestPayload[] = batch.map((number) => ({ number, carrier: this.dhlCarrierCode }));
      try {
        const { data } = await axios.post<TrackInfoApiResponse>(this.deleteTrackUrl, payload, { headers: this.headers });
        deleted.push(...(data?.data?.accepted ?? []).map((a) => a.number));
        // Si 17TRACK rechaza el borrado (p.ej. ya no existe), igual liberamos el slot
        // de nuestro lado: lo tratamos como borrado para no quedarnos "pegados".
        for (const r of data?.data?.rejected ?? []) deleted.push(r.number);
      } catch (error: any) {
        this.logger.warn(`17TRACK deletetrack falló: ${error?.message}. ${JSON.stringify(error?.response?.data)}`);
      }
    }

    this.logger.log(`17TRACK: liberados ${deleted.length}/${clean.length} slots de quota (deletetrack).`);
    return { deleted };
  }

  /** Convierte un item aceptado v2.4 al shape normalizado de la app. */
  private normalize(item: V24AcceptedItem, localTimestamp: string): NormalizedTrackingResult {
    const info = item.track_info ?? null;
    const status = info?.latest_status?.status || 'UNKNOWN';
    const subStatus = info?.latest_status?.sub_status || null;

    // Evento más reciente: prioriza latest_event; si no, el primero del primer provider.
    const rawEvent =
      info?.latest_event ?? info?.tracking?.providers?.[0]?.events?.[0] ?? null;
    const latestEvent: TrackEvent | null = rawEvent
      ? {
          time: rawEvent.time_iso || rawEvent.time_utc || '',
          description: rawEvent.description || '',
          location: rawEvent.location || '',
        }
      : null;

    return {
      trackingNumber: item.number,
      currentStatus: status,
      subStatus,
      latestEvent,
      localTimestamp,
      rawTrackingData: info,
    };
  }

  private chunk<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }
}

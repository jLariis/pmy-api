import { Injectable, Logger } from '@nestjs/common';
import { FedexService } from 'src/shipments/fedex.service';
import { LatestScanEvent, LatestStatusResult, StatusValidation } from './fedex-status.types';
import { isDeliveredStatus, isTerminalStatus, resolveCanonicalStatus } from './fedex-status.mapping';

/**
 * Servicio NUEVO (read-only) que siempre trae el ÚLTIMO estatus del paquete desde FedEx.
 * Reusa `FedexService` (token/backoff/401 ya resueltos) y normaliza + valida la respuesta a un
 * `LatestStatusResult` canónico. No escribe en BD: el caller decide si persiste.
 */
@Injectable()
export class FedexStatusResolver {
  private readonly logger = new Logger(FedexStatusResolver.name);

  constructor(private readonly fedexService: FedexService) {}

  /** Último estatus de una guía. Nunca lanza: ante error/red devuelve `found:false` con `error`. */
  async getLatestStatus(
    trackingNumber: string,
    opts: { fedexUniqueId?: string; carrierCode?: string } = {},
  ): Promise<LatestStatusResult> {
    try {
      const response = await this.fedexService.trackPackage(
        trackingNumber,
        opts.fedexUniqueId,
        opts.carrierCode,
      );
      const track = response?.output?.completeTrackResults?.[0]?.trackResults?.[0];
      return this.buildResult(trackingNumber, track);
    } catch (error: any) {
      this.logger.warn(`No se pudo resolver estatus de ${trackingNumber}: ${error?.message}`);
      return this.emptyResult(trackingNumber, error?.message ?? 'Error consultando FedEx');
    }
  }

  /** Último estatus de varias guías (usa el endpoint batch de FedEx). */
  async getLatestStatusBatch(trackingNumbers: string[]): Promise<LatestStatusResult[]> {
    const unique = [...new Set((trackingNumbers || []).filter(Boolean))];
    if (unique.length === 0) return [];

    try {
      const map = await this.fedexService.trackBatch(
        unique.map((trackingNumber) => ({ trackingNumber })),
        'fedex-status',
      );
      return unique.map((tn) => this.buildResult(tn, map.get(tn)?.[0]));
    } catch (error: any) {
      this.logger.warn(`Batch de estatus falló: ${error?.message}`);
      return unique.map((tn) => this.emptyResult(tn, error?.message ?? 'Error consultando FedEx'));
    }
  }

  /** Construye el resultado canónico a partir de un trackResult crudo de FedEx. */
  private buildResult(trackingNumber: string, track: any): LatestStatusResult {
    const fetchedAt = new Date();

    if (!track) {
      return { ...this.emptyResult(trackingNumber, 'Sin trackResult en la respuesta'), fetchedAt };
    }

    const latest = track.latestStatusDetail ?? null;
    const lastScan = this.latestScanEvent(track.scanEvents);

    const derivedCode: string | null = latest?.derivedCode ?? null;
    const statusCode: string | null = latest?.code ?? null;
    const exceptionCode: string | null =
      latest?.ancillaryDetails?.[0]?.reason ?? lastScan?.exceptionCode ?? null;

    const status = resolveCanonicalStatus({ derivedCode, statusCode, exceptionCode });

    const lastEvent: LatestScanEvent | null = lastScan
      ? {
          type: lastScan.eventType ?? null,
          description: lastScan.eventDescription ?? null,
          date: lastScan.date ? new Date(lastScan.date) : null,
          location: lastScan.scanLocation?.city ?? null,
          exceptionCode: lastScan.exceptionCode ?? null,
        }
      : null;

    const validation = this.validate(track, latest, lastScan);

    return {
      trackingNumber,
      found: !!latest || !!lastScan,
      status,
      derivedCode,
      statusCode,
      exceptionCode,
      statusByLocale: latest?.statusByLocale ?? null,
      description: latest?.description ?? null,
      isDelivered: isDeliveredStatus(status),
      isTerminal: isTerminalStatus(status),
      lastEvent,
      commitDateTime: this.extractCommitDateTime(track),
      validation,
      fetchedAt,
      error: track.error?.message ?? undefined,
    };
  }

  /** Valida la CALIDAD del dato de FedEx (no reglas de negocio). */
  private validate(track: any, latest: any, lastScan: any): StatusValidation {
    const issues: string[] = [];
    if (track.error?.message) issues.push(`FedEx error: ${track.error.message}`);
    if (!latest) issues.push('Sin latestStatusDetail');
    if (!latest?.derivedCode && !latest?.code) issues.push('Sin derivedCode ni code');
    if (!Array.isArray(track.scanEvents) || track.scanEvents.length === 0) {
      issues.push('Sin scanEvents');
    }
    if (latest && lastScan && latest.derivedCode && lastScan.eventType && !this.consistent(latest.derivedCode, lastScan.eventType)) {
      // No es error, solo señal: el último evento no coincide con el estatus resumido.
      issues.push(`derivedCode(${latest.derivedCode}) ≠ último evento(${lastScan.eventType})`);
    }
    return { ok: issues.length === 0, issues };
  }

  /** Heurística ligera: el derivedCode suele igualar el eventType del último scan. */
  private consistent(derivedCode: string, eventType: string): boolean {
    return derivedCode.toUpperCase() === eventType.toUpperCase();
  }

  private latestScanEvent(scanEvents?: any[]): any | undefined {
    if (!scanEvents?.length) return undefined;
    return [...scanEvents].sort(
      (a, b) => new Date(b?.date || 0).getTime() - new Date(a?.date || 0).getTime(),
    )[0];
  }

  private extractCommitDateTime(track: any): Date | null {
    const fromDateAndTimes = track.dateAndTimes?.find(
      (dt: any) => dt.type === 'ESTIMATED_DELIVERY' || dt.type === 'COMMIT' || dt.type === 'APPOINTMENT_DELIVERY',
    )?.dateTime;
    const raw =
      fromDateAndTimes ||
      track.estimatedDeliveryTimeWindow?.window?.ends ||
      track.standardTransitTimeWindow?.window?.ends;
    if (!raw) return null;
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }

  private emptyResult(trackingNumber: string, error?: string): LatestStatusResult {
    return {
      trackingNumber,
      found: false,
      status: null,
      derivedCode: null,
      statusCode: null,
      exceptionCode: null,
      statusByLocale: null,
      description: null,
      isDelivered: false,
      isTerminal: false,
      lastEvent: null,
      commitDateTime: null,
      validation: { ok: false, issues: [error ?? 'Sin datos'] },
      fetchedAt: new Date(),
      error,
    };
  }
}

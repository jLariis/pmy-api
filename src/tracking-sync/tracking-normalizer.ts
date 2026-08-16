import { Injectable } from '@nestjs/common';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { resolveCanonicalStatus } from 'src/fedex-status/fedex-status.mapping';
import { buildEventKey, buildShadowKey } from './event-key.util';
import { NormalizedEvent, NormalizedTracking, RawTrackingResult, StatusValidation } from './tracking-sync.types';

/**
 * Convierte un trackResult crudo de FedEx en la lista COMPLETA de eventos normalizados,
 * ordenada cronológicamente. Reutiliza el mapeo canónico único. No toca la BD.
 */
@Injectable()
export class TrackingNormalizer {
  normalize(raw: RawTrackingResult): NormalizedTracking {
    const track = raw.trackResults?.[0] ?? null;
    const scanEvents: any[] = track?.scanEvents ?? [];

    const events: NormalizedEvent[] = scanEvents
      .map((s) => this.buildEvent(raw.trackingNumber, s))
      .filter((e): e is NormalizedEvent => e !== null)
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

    const latest = events.length ? events[events.length - 1] : null;

    return {
      trackingNumber: raw.trackingNumber,
      events,
      latest,
      commitDateTime: this.extractCommitDateTime(track),
      validation: this.validate(track, events),
    };
  }

  private buildEvent(trackingNumber: string, scan: any): NormalizedEvent | null {
    if (!scan?.date) return null;
    const occurredAt = new Date(scan.date);
    if (isNaN(occurredAt.getTime())) return null;

    const derivedCode: string | null = scan.derivedStatusCode ?? null;
    const eventType: string | null = scan.eventType ?? null;
    const statusCode: string | null = scan.derivedStatusCode ?? scan.eventType ?? null;
    const exceptionCode: string | null = (scan.exceptionCode || '').trim() || null;
    const location: string | null = scan.scanLocation?.city ?? null;

    const status =
      resolveCanonicalStatus({ derivedCode, statusCode, exceptionCode }) ?? ShipmentStatusType.DESCONOCIDO;

    return {
      occurredAt,
      derivedCode,
      statusCode,
      exceptionCode,
      eventType,
      description: scan.eventDescription ?? null,
      location,
      status,
      eventKey: buildEventKey({ trackingNumber, occurredAt, derivedCode, eventType, exceptionCode, location }),
      shadowKey: buildShadowKey(occurredAt.getTime(), exceptionCode, status),
    };
  }

  private validate(track: any, events: NormalizedEvent[]): StatusValidation {
    const issues: string[] = [];
    if (track?.error?.message) issues.push(`FedEx error: ${track.error.message}`);
    if (!track?.latestStatusDetail) issues.push('Sin latestStatusDetail');
    if (events.length === 0) issues.push('Sin scanEvents');
    return { ok: issues.length === 0, issues };
  }

  private extractCommitDateTime(track: any): Date | null {
    if (!track) return null;
    const fromDateAndTimes = track.dateAndTimes?.find(
      (dt: any) => ['ESTIMATED_DELIVERY', 'COMMIT', 'APPOINTMENT_DELIVERY'].includes(dt.type),
    )?.dateTime;
    const rawDate =
      fromDateAndTimes ||
      track.estimatedDeliveryTimeWindow?.window?.ends ||
      track.standardTransitTimeWindow?.window?.ends;
    if (!rawDate) return null;
    const d = new Date(rawDate);
    return isNaN(d.getTime()) ? null : d;
  }
}

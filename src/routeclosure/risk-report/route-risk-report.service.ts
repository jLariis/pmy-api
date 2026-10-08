import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PackageDispatch } from 'src/entities/package-dispatch.entity';
import { MailService } from 'src/mail/mail.service';
import { toHermosilloDateString } from 'src/common/utils';
import { ClosureDoctorService } from '../closure-doctor.service';
import { buildRouteRiskReport, RiskRouteInput, RouteRiskReport } from './route-risk-report.util';

/** Destinatarios (decisión del usuario 2026-10-08): solo Javier, copia a sistemas. */
const DEFAULT_TO = 'javier.rappaz@gmail.com';
const DEFAULT_CC = 'sistemas@paqueteriaymensajeriadelyaqui.com';

/**
 * Reporte diario de las 7 pm: revisa contra FedEx (motor de "Paquetes con problema") todas las
 * salidas a ruta del día y avisa por correo cuáles podrían dar problemas en el cierre, para
 * corregirlas antes. Solo lectura: no cambia estatus ni ingresos.
 */
@Injectable()
export class RouteRiskReportService {
  private readonly logger = new Logger(RouteRiskReportService.name);
  private running = false;

  constructor(
    @InjectRepository(PackageDispatch)
    private readonly dispatchRepo: Repository<PackageDispatch>,
    private readonly doctor: ClosureDoctorService,
    private readonly mail: MailService,
  ) {}

  @Cron('0 0 19 * * *', { timeZone: 'America/Hermosillo' })
  async handleDailyReport(): Promise<void> {
    try {
      await this.send();
    } catch (e: any) {
      this.logger.error(`📋 [Rutas en riesgo] No se pudo enviar el reporte: ${e?.message ?? e}`);
    }
  }

  /** Salidas activas (no canceladas) cuyo día operativo es `day` (yyyy-MM-dd Hermosillo). */
  private async dispatchesOf(day: string): Promise<PackageDispatch[]> {
    return this.dispatchRepo
      .createQueryBuilder('pd')
      .leftJoinAndSelect('pd.subsidiary', 'subsidiary')
      .leftJoinAndSelect('pd.drivers', 'drivers')
      .leftJoinAndSelect('pd.routeClosure', 'routeClosure')
      .where('pd.active = 1')
      .andWhere("pd.status <> 'Cancelada'")
      .andWhere(
        "(pd.routeDate = :day OR (pd.routeDate IS NULL AND DATE(CONVERT_TZ(pd.createdAt, '+00:00', '-07:00')) = :day))",
        { day },
      )
      .orderBy('subsidiary.name', 'ASC')
      .getMany();
  }

  /** Arma el reporte del día (sin enviar). Una ruta que falla no tumba a las demás. */
  async build(day = toHermosilloDateString(new Date())): Promise<RouteRiskReport & { day: string }> {
    const dispatches = await this.dispatchesOf(day);
    const routes: RiskRouteInput[] = [];
    // Secuencial: cada diagnóstico ya consulta FedEx en paralelo por guía.
    for (const pd of dispatches) {
      const base: RiskRouteInput = {
        folio: pd.trackingNumber,
        subsidiaryName: pd.subsidiary?.name ?? 'Sin sucursal',
        drivers: (pd.drivers ?? []).map((d) => d.name).filter(Boolean).join(', '),
        total: 0,
        is315: !!pd.is315,
        closed: !!pd.routeClosure,
        untilNextDispatch: !!pd.subsidiary?.closureUntilNextDispatch,
        withoutOutcome: [],
        packages: [],
        error: null,
      };
      try {
        const d = await this.doctor.diagnoseRoute(pd.id);
        base.total = d.total;
        base.withoutOutcome = d.withoutOutcome;
        base.packages = d.packages.map((p) => ({
          trackingNumber: p.trackingNumber,
          kind: p.kind,
          problems: p.problems,
          currentStatus: p.currentStatus,
          targetStatus: p.targetStatus,
          explanation: p.explanation,
        }));
      } catch (e: any) {
        this.logger.error(`📋 [Rutas en riesgo] Error revisando ${pd.trackingNumber}: ${e?.message ?? e}`);
        base.error = 'No se pudo revisar esta ruta contra FedEx. Revísala a mano desde el cierre.';
      }
      routes.push(base);
    }
    const frontend = process.env.FRONTEND_URL ?? 'https://app-pmy.vercel.app';
    return { day, ...buildRouteRiskReport(day, routes, frontend) };
  }

  /** Arma y envía el reporte. Evita corridas encimadas (cron + botón manual). */
  async send(day?: string, opts: { dryRun?: boolean } = {}) {
    if (this.running) return { skipped: true, reason: 'Ya hay un reporte en proceso.' };
    this.running = true;
    try {
      const report = await this.build(day);
      if (!opts.dryRun) {
        await this.mail.sendEmailNotification({
          to: process.env.ROUTE_RISK_REPORT_TO || DEFAULT_TO,
          cc: process.env.ROUTE_RISK_REPORT_CC || DEFAULT_CC,
          subject: report.subject,
          htmlContent: report.html,
        });
      }
      this.logger.log(
        `📋 [Rutas en riesgo] ${report.day}: ${report.totals.routesWithIssues}/${report.totals.routes} rutas con posibles problemas` +
          (opts.dryRun ? ' (vista previa, sin enviar).' : ' — correo enviado.'),
      );
      return report;
    } finally {
      this.running = false;
    }
  }
}

import { Injectable } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import { PackageDispatch } from 'src/entities/package-dispatch.entity';
import { Unloading } from 'src/entities/unloading.entity';
import { ShipmentStatusForReportDto } from './dtos/shipment.dto';
import { formatToHermosillo } from 'src/common/utils';
import { RouteClosure } from 'src/entities/route-closure.entity';
import { Inventory } from 'src/entities/inventory.entity';
import { Subsidiary } from 'src/entities';
import { ConfigService } from '@nestjs/config';
import { TemplateService } from 'src/documents/template.service';

interface SendEmailOptions {
  to: string | string[];
  cc?: string | string[];
  subject: string
  htmlContent: string;
  attachments?: { filename: string; content: Buffer }[];
}

@Injectable()
export class MailService {
  constructor(
    private readonly mailerService: MailerService,
    private readonly configService: ConfigService,
    private readonly templates: TemplateService,
  ) {}

  /**
   * Método privado para filtrar destinatarios según el ambiente.
   * Si es development, redirige todo a sistemas.
   */
  private applyDevFilters(to: string | string[], cc?: string | string[]) {
    const isDev = this.configService.get('NODE_ENV') === 'dev';
    const systemsEmail = 'javier.rappaz@gmail.com';

    if (isDev) {
      return {
        to: systemsEmail,
        cc: [], // En desarrollo limpiamos el CC para evitar spam
      };
    }

    return { to, cc };
  }

  /** Base del frontend sin barra final, para componer links de correo. */
  private detailBase(): string {
    return (process.env.FRONTEND_URL ?? 'https://app-pmy.vercel.app').replace(/\/+$/, '');
  }

  /** Link "ver en el sistema": ruta de módulo + ?seguimiento= (si hay guía). */
  private buildDetailLink(path: string, tracking?: string): string {
    const url = `${this.detailBase()}${path}`;
    return tracking ? `${url}?seguimiento=${encodeURIComponent(tracking)}` : url;
  }

  formatMexicanPhoneNumber = (phone: string): string => {
    // Quita todo lo que no sea dígito
    let cleaned = phone.replace(/\D/g, "");

    // Si ya empieza con 52 o 521, quitamos el 52 y dejamos solo los 10 dígitos
    if (cleaned.startsWith("521")) {
      cleaned = cleaned.slice(3);
    } else if (cleaned.startsWith("52")) {
      cleaned = cleaned.slice(2);
    }

    // Ahora cleaned debería tener solo 10 dígitos
    if (cleaned.length === 10) {
      return `+52 (${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    }

    // Si no cumple, regresamos el original sin cambios
    return phone;
  };

  /** Enviar correo de Envios priotitarios */
  async sendHighPriorityShipmentsEmail(options: { to: string | string[], cc?: string | string[], htmlContent: string }) {
    const { to, cc } = this.applyDevFilters(options.to, options.cc);
    const r = await this.templates.render('high_priority_shipments', { tableHtml: options.htmlContent });

    try {
      await this.mailerService.sendMail({
        to,
        cc,
        subject: r.subject,
        html: r.html,
        headers: {
          'X-Priority': '1',
          'X-MSMail-Priority': 'High',
          Importance: 'High',
        },
      });
    } catch (error) {
      console.error('Error al enviar correo:', error);
      throw error;
    }
  }

  /*** Enviar correo Salida a Ruta */
  async sendHighPriorityPackageDispatchEmail(
    pdfFile: Express.Multer.File, excelFile: Express.Multer.File, subsidiaryName: string, packageDispatch: PackageDispatch,
  ) {
    const attachments = [
      { filename: pdfFile.originalname, content: pdfFile.buffer },
      { filename: excelFile.originalname, content: excelFile.buffer },
    ];
    const rendered = await this.templates.render('route_dispatch', {
      subsidiaryName,
      vehicleName: packageDispatch.vehicle?.name ?? 'N/A',
      createdAt: packageDispatch.createdAt,
      drivers: packageDispatch.drivers.map((d) => d.name).join(' - '),
      routes: packageDispatch.routes.map((r) => r.name).join(' -> '),
      trackingNumber: packageDispatch.trackingNumber,
      driverName: packageDispatch.drivers?.[0]?.name ?? 'Sin chofer',
      detailLink: this.buildDetailLink('/operaciones/salidas-a-ruta', packageDispatch.trackingNumber),
    });
    const { to, cc } = this.applyDevFilters(
      packageDispatch.subsidiary.officeEmail,
      `${packageDispatch.subsidiary.officeEmailToCopy}, sistemas@paqueteriaymensajeriadelyaqui.com`,
    );
    try {
      await this.mailerService.sendMail({ to, cc, subject: rendered.subject, html: rendered.html, attachments });
    } catch (error) {
      console.log(error);
      throw error;
    }
  }

  /*** Enviar correo Desembarque */
  async sendHighPriorityUnloadingEmail(
    file: Express.Multer.File,
    excelFile: Express.Multer.File,
    subsidiaryName: string,
    unloading: Unloading
  ) {
    const attachments = [
      { filename: file.originalname, content: file.buffer },
      { filename: excelFile.originalname, content: excelFile.buffer },
    ];

    const rendered = await this.templates.render('unloading', {
      subsidiaryName,
      vehicleName: unloading.vehicle?.name,
      createdAt: unloading.createdAt,
      trackingNumber: unloading.trackingNumber,
      detailLink: this.buildDetailLink('/operaciones/desembarques', unloading.trackingNumber),
    });

    const { to, cc } = this.applyDevFilters(
      unloading.subsidiary.officeEmail,
      `${unloading.subsidiary.officeEmailToCopy}, sistemas@paqueteriaymensajeriadelyaqui.com`
    );

    try {
      await this.mailerService.sendMail({
        to,
        cc,
        subject: rendered.subject,
        html: rendered.html,
        attachments,
      })

    } catch (error) {
      console.log(error);
      throw error;
    }
  }

  /** Enviar correo de prioridades dentro de Desembarque */
  async sendHighPriorityUnloadingPriorityPackages(options: { to: string | string[], cc?: string | string[], htmlContent: string }) {
    const { to, cc } = this.applyDevFilters(options.to, options.cc);
    const r = await this.templates.render('unloading_priority_packages', { tableHtml: options.htmlContent });

    try {
      await this.mailerService.sendMail({
        to,
        cc,
        subject: r.subject,
        html: r.html,
        headers: {
        },
      });
    } catch (error) {
      console.error('Error al enviar correo:', error);
      throw error;
    }
  }

  /*** Enviar correo Devoluciones/Recolecciones */
  async sendHighPriorityDevolutionsEmail(
    file: Express.Multer.File,
    excelFile: Express.Multer.File,
    subsidiary: Subsidiary,
  ){
    const attachments = [
      { filename: file.originalname, content: file.buffer },
      { filename: excelFile.originalname, content: excelFile.buffer },
    ];

    const rendered = await this.templates.render('devolutions', {
      subsidiaryName: subsidiary.name,
      createdAt: new Date(),
      detailLink: this.buildDetailLink('/operaciones/devoluciones'),
    });

    const { to, cc } = this.applyDevFilters(
      subsidiary.officeEmail,
      `${subsidiary.officeEmailToCopy}, sistemas@paqueteriaymensajeriadelyaqui.com`
    );

    try {
      await this.mailerService.sendMail({
        to,
        cc,
        subject: rendered.subject,
        html: rendered.html,
        attachments,
      })

    } catch (error) {
      console.log(error);
      throw error;
    }


  }

  /*** Correos de DEX03 - Reporte */
  async sendHighPriorityShipmentWithStatus03(
    subsidiary: Subsidiary,
    shipments: ShipmentStatusForReportDto[]
  ) {
    const rendered = await this.templates.render('dex03_report', {
      subsidiaryName: subsidiary.name,
      today: new Date(),
      rows: shipments.map((s) => ({
        trackingNumber: s.trackingNumber,
        recipientName: s.recipientName,
        recipientAddress: s.recipientAddress,
        recipientZip: s.recipientZip,
        timestamp: formatToHermosillo(s.timestamp),
        doItByUser: s.doItByUser,
        recipientPhone: this.formatMexicanPhoneNumber(s.recipientPhone),
      })),
      detailLink: this.buildDetailLink('/reportes'),
    });

    const { to, cc } = this.applyDevFilters(
      'paqueteriaymensajeriadelyaqui@hotmail.com',
      `edgardolugo@paqueteriaymensajeriadelyaqui.com, gerardorobles@paqueteriaymensajeriadelyaqui.com, sistemas@paqueteriaymensajeriadelyaqui.com, ${subsidiary.officeEmail}, ${subsidiary.officeEmailToCopy}`
    );

    try {
      return await this.mailerService.sendMail({
        to,
        cc,
        subject: rendered.subject,
        html: rendered.html,
        headers: {
          'X-Priority': '1',
          'X-MSMail-Priority': 'High',
          Importance: 'High',
        },
      })

    } catch (error) {
      console.log(error);
      throw error;
    }
  }

  /*** Enviar correo Cierre de Ruta */
  async sendHighPriorityRouteClosureEmail(
    file: Express.Multer.File,
    excelFile: Express.Multer.File,
    routeClosure: RouteClosure,
  ){
    const attachments = [
      { filename: file.originalname, content: file.buffer },
      { filename: excelFile.originalname, content: excelFile.buffer },
    ];

    const rendered = await this.templates.render('route_closure', {
      subsidiaryName: routeClosure.subsidiary.name,
      driverName: routeClosure.packageDispatch.drivers[0]?.name,
      createdAt: new Date(),
      trackingNumber: routeClosure.packageDispatch?.trackingNumber,
      detailLink: this.buildDetailLink('/operaciones/salidas-a-ruta', routeClosure.packageDispatch?.trackingNumber),
    });

    const { to, cc } = this.applyDevFilters(
      routeClosure.subsidiary.officeEmail,
      `${routeClosure.subsidiary.officeEmailToCopy}, sistemas@paqueteriaymensajeriadelyaqui.com`
    );

    try {
      const emailSent = await this.mailerService.sendMail({
        to,
        cc,
        subject: rendered.subject,
        html: rendered.html,
        attachments,
      })

      console.log("🚀 ~ MailService ~ sendHighPriorityRouteClosureEmail ~ emailSent:", emailSent)

    } catch (error) {
      console.log(error);
      throw error;
    }


  }

  /** Enviar correo de  Invetario */
  async sendHighPriorityInventoryEmail(
    file: Express.Multer.File,
    excelFile: Express.Multer.File,
    subsidiaryName: string,
    inventory: Inventory
  ) {
    const attachments = [
      { filename: file.originalname, content: file.buffer },
      { filename: excelFile.originalname, content: excelFile.buffer },
    ];

    const rendered = await this.templates.render('inventory_report', {
      subsidiaryName,
      inventoryDate: inventory.inventoryDate,
      trackingNumber: inventory.trackingNumber,
      detailLink: this.buildDetailLink('/operaciones/inventarios', inventory.trackingNumber),
    });

    const { to, cc } = this.applyDevFilters(
      inventory.subsidiary.officeEmail,
      `${inventory.subsidiary.officeEmailToCopy}, sistemas@paqueteriaymensajeriadelyaqui.com`
    );

    try {
      await this.mailerService.sendMail({
        to,
        cc,
        subject: rendered.subject,
        html: rendered.html,
        attachments,
      })

    } catch (error) {
      console.log(error);
      throw error;
    }
  }

  /** Enviar correo de prioridades dentro de Inventario */
  async sendHighPriorityPackagesOnInvetory(options: { to: string | string[], cc?: string | string[], htmlContent: string }) {
    const { to, cc } = this.applyDevFilters(options.to, options.cc);
    const r = await this.templates.render('inventory_priority_packages', { tableHtml: options.htmlContent });

    try {
      await this.mailerService.sendMail({
        to,
        cc,
        subject: r.subject,
        html: r.html,
        headers: {
        },
      });
    } catch (error) {
      console.error('Error al enviar correo:', error);
      throw error;
    }
  }

  async sendEmailNotification(options: SendEmailOptions, isDev: boolean = false) { 
    try {
      const { to, cc } = this.applyDevFilters(options.to, options.cc);

      await this.mailerService.sendMail({
        to: to,
        cc: cc,
        subject: options.subject,
        html: options.htmlContent,
        attachments: options.attachments,
      });

    } catch (error) {
      console.error('Error al enviar correo:', error);
      throw error;
    }
  }

}

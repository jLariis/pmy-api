import { Injectable } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { PackageDispatch } from 'src/entities/package-dispatch.entity';
import { Unloading } from 'src/entities/unloading.entity';
import { ShipmentStatusForReportDto } from './dtos/shipment.dto';
import { formatToHermosillo } from 'src/common/utils';
import { RouteClosure } from 'src/entities/route-closure.entity';
import { Inventory } from 'src/entities/inventory.entity';
import { Subsidiary } from 'src/entities';
import { ConfigService } from '@nestjs/config';

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
    private readonly configService: ConfigService
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
    //const { to, cc, htmlContent } = options;
    const { to, cc } = this.applyDevFilters(options.to, options.cc);
    
    try {
      await this.mailerService.sendMail({
        to,
        cc,
        subject: '🔴 Envíos con Prioridad Alta en Curso',
        html: options.htmlContent,
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
    pdfFile: Express.Multer.File, 
    excelFile: Express.Multer.File, 
    subsidiaryName: string,
    packageDispatch: PackageDispatch
  ) {
    const timeZone = 'America/Hermosillo'; 

    const attachments = [
      {
        filename: pdfFile.originalname,
        content: pdfFile.buffer
      },
      {
        filename: excelFile.originalname,
        content: excelFile.buffer
      },
    ]

    const now = new Date();
    const zonedDate = toZonedTime(now, timeZone);
    const formattedDate = format(zonedDate, "dd-MM-yyyy");

    const drivers = packageDispatch.drivers.map(driver => driver.name).join(" - ");
    const routes = packageDispatch.routes.map(route => route.name).join(" -> ");

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; color: #2c3e50; max-width: 800px; margin: auto;">
        <h2 style="border-bottom: 3px solid #3498db; padding-bottom: 8px;">
          🚚 Reporte de Salida a Ruta
        </h2>

        <p>
          Se ha generado un nuevo reporte de <strong>Salida a Ruta</strong> para la sucursal <strong>${subsidiaryName}</strong> saliendo en la unidad <strong>${packageDispatch.vehicle.name}</strong>.
        </p>


        <p><strong>Fecha y hora:</strong> ${format(toZonedTime(packageDispatch.createdAt, timeZone), 'dd/MM/yyyy hh:mm aa')}</p>
        <p><strong>Responsable(s):</strong> ${drivers}</p>
        <p><strong>Siguiendo la ruta(s):</strong> ${routes}</p>

        <p style="margin-top: 20px;">Adjunto se detalla la información correspondiente a los paquetes incluidos.</p>

        <p style="margin-top: 20px;">
          Puede consultar más detalles utilizando el Número de seguimiento <strong>${packageDispatch.trackingNumber}</strong> en: 
          <a href="https://app-pmy.vercel.app/" target="_blank" style="color: #2980b9; text-decoration: none;">
            https://app-pmy.vercel.app/
          </a>
        </p>

        <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;" />

        <p style="font-size: 0.9em; color: #7f8c8d;">
          Este correo fue enviado automáticamente por el sistema.<br />
          Por favor, no responda a este mensaje.
        </p>
      </div>
    `;

    const { to, cc } = this.applyDevFilters(
      packageDispatch.subsidiary.officeEmail,
      `${packageDispatch.subsidiary.officeEmailToCopy}, sistemas@paqueteriaymensajeriadelyaqui.com`
    );

    try {
      await this.mailerService.sendMail({
        to,
        cc,
        //subject: `🚚 Salida a Ruta ${formattedDate} de ${subsidiaryName}`,
        subject: `🚚 SALIDA ${packageDispatch.drivers[0].name.toLocaleUpperCase()} ${formattedDate}`,
        html: htmlContent,
        headers: {
        },
        attachments: attachments
      })

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
    const timeZone = 'America/Hermosillo'; 

    const attachments = [
      {
        filename: file.originalname,
        content: file.buffer
      },
      {
        filename: excelFile.originalname,
        content: excelFile.buffer
      }
    ]

    const now = new Date();
    const zonedDate = toZonedTime(now, timeZone);
    const formattedDate = format(zonedDate, "dd-MM-yyyy");

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; color: #2c3e50; max-width: 800px; margin: auto;">
        <h2 style="border-bottom: 3px solid #3498db; padding-bottom: 8px;">
          🚚 Reporte de Desembarque
          
        </h2>

        <p>
          Se ha generado un nuevo reporte de <strong>Desembarque</strong> para la sucursal <strong>${subsidiaryName}</strong> descargado de la unidad <strong>${unloading.vehicle.name}</strong>.
        </p>


        <p><strong>Fecha y hora:</strong> ${format(toZonedTime(unloading.createdAt, timeZone), 'dd/MM/yyyy hh:mm aa')}</p>
      
        <p style="margin-top: 20px;">A continuación se detalla la información correspondiente a los paquetes incluidos:</p>

        <p style="margin-top: 20px;">
          Puede consultar más detalles utilizando el Número de seguimiento <strong>${unloading.trackingNumber}</strong> en: 
          <a href="https://app-pmy.vercel.app/" target="_blank" style="color: #2980b9; text-decoration: none;">
            https://app-pmy.vercel.app/
          </a>
        </p>

        <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;" />

        <p style="font-size: 0.9em; color: #7f8c8d;">
          Este correo fue enviado automáticamente por el sistema.<br />
          Por favor, no responda a este mensaje.
        </p>
      </div>
    `;

    const { to, cc } = this.applyDevFilters(
      unloading.subsidiary.officeEmail,
      `${unloading.subsidiary.officeEmailToCopy}, sistemas@paqueteriaymensajeriadelyaqui.com`
    );

    try {
      await this.mailerService.sendMail({
        to,
        cc,
        subject: `🚚 Desembarque ${formattedDate} de ${subsidiaryName}`,
        html: htmlContent,
        headers: {
        },
        attachments: attachments
      })

    } catch (error) {
      console.log(error);
      throw error;
    }
  }

  /** Enviar correo de prioridades dentro de Desembarque */
  async sendHighPriorityUnloadingPriorityPackages(options: { to: string | string[], cc?: string | string[], htmlContent: string }) {
    const { to, cc } = this.applyDevFilters(options.to, options.cc);
    
    try {
      await this.mailerService.sendMail({
        to,
        cc,
        subject: '🔴 Envíos con Prioridad Alta en Descarga',
        html: options.htmlContent,
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
    const timeZone = 'America/Hermosillo'; 

    const attachments = [
      {
        filename: file.originalname,
        content: file.buffer
      },
      {
        filename: excelFile.originalname,
        content: excelFile.buffer
      }
    ]

    const now = new Date();
    const zonedDate = toZonedTime(now, timeZone);
    const formattedDate = format(zonedDate, "dd-MM-yyyy");

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; color: #2c3e50; max-width: 800px; margin: auto;">
        <h2 style="border-bottom: 3px solid #3498db; padding-bottom: 8px;">
          🚚 Reporte de Devoluciones/Recolecciones
          
        </h2>

        <p>
          Se ha generado un nuevo reporte de <strong>Devoluciones/Recolecciones</strong> para la sucursal <strong>${subsidiary.name}</strong>.
        </p>

        <p style="margin-top: 20px;">
          Puede consultar más detalles en: 
          <a href="https://app-pmy.vercel.app/" target="_blank" style="color: #2980b9; text-decoration: none;">
            https://app-pmy.vercel.app/
          </a>
        </p>

        <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;" />

        <p style="font-size: 0.9em; color: #7f8c8d;">
          Este correo fue enviado automáticamente por el sistema.<br />
          Por favor, no responda a este mensaje.
        </p>
      </div>
    `;

    const { to, cc } = this.applyDevFilters(
      subsidiary.officeEmail,
      `${subsidiary.officeEmailToCopy}, sistemas@paqueteriaymensajeriadelyaqui.com`
    );

    try {
      await this.mailerService.sendMail({
        to,
        cc,
        subject: `🚚 Devoluciones/Recolecciones ${formattedDate} de ${subsidiary.name}`,
        html: htmlContent,
        headers: {
        },
        attachments: attachments
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
    const today = new Date()

    const htmlRows = shipments
        .map(
          (s) => `
          <tr style="border-bottom: 1px solid #ddd;">
            <td style="padding: 8px; text-align: center;">${s.trackingNumber}</td>
            <td style="padding: 8px;">${s.recipientName}</td>
            <td style="padding: 8px; text-align: center;">${s.recipientAddress}</td>
            <td style="padding: 8px; text-align: center;">${s.recipientZip}</td>
            <td style="padding: 8px; text-align: center;">${formatToHermosillo(s.timestamp)}</td>
            <td style="padding: 8px; text-align: center;">${s.doItByUser}</td>
            <td style="padding: 8px; text-align: center;">${this.formatMexicanPhoneNumber(s.recipientPhone)}</td>
          </tr>
        `
        )
        .join('');

    const htmlContent = `
        <div style="font-family: Arial, sans-serif; color: #2c3e50; max-width: 800px; margin: auto;">
          <h2 style="border-bottom: 3px solid #e74c3c; padding-bottom: 8px;">
            Reporte de Paquetes con DEX03 de la sucursal ${subsidiary.name.toUpperCase()}
          </h2>
          <p>
            Se han detectado los siguientes envíos con el status DEX03
          </p>
          <p><em>Por favor considere la fecha de recepción de este correo (<strong>${today.toLocaleDateString()}</strong>) para el seguimiento y gestión de estos envíos.</em></p>

          <table 
            border="0" 
            cellpadding="0" 
            cellspacing="0" 
            style="border-collapse: collapse; width: 100%; box-shadow: 0 0 10px rgba(0,0,0,0.05);"
          >
            <thead style="background-color: #f7f7f7; text-align: center;">
              <tr>
                <th style="padding: 10px;">Tracking Number</th>
                <th style="padding: 10px;">Nombre</th>
                <th style="padding: 10px;">Dirección</th>
                <th style="padding: 10px;">Código Postal</th>
                <th style="padding: 10px;">Fecha del Evento</th>
                <th style="padding: 10px;">Realizado por</th>
                <th style="padding: 10px;">Número de Teléfono</th>
              </tr>
            </thead>
            <tbody>
              ${htmlRows}
            </tbody>
          </table>

          <p style="margin-top: 20px; font-weight: bold; color: #c0392b;">
            Este correo ha sido enviado con <strong>alta prioridad</strong> debido a la criticidad de los envíos.
          </p>

          <p style="margin-top: 20px;">
            Para hacer un monitoreo detallado de los envíos, por favor visite: 
            <a href="https://app-pmy.vercel.app/" target="_blank" style="color: #2980b9; text-decoration: none;">
              https://app-pmy.vercel.app/
            </a>
          </p>

          <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;" />

          <p style="font-size: 0.9em; color: #7f8c8d;">
            Este correo fue enviado automáticamente por el sistema.<br />
            Por favor, no responda a este mensaje.
          </p>
        </div>
      `;

    const { to, cc } = this.applyDevFilters(
      'paqueteriaymensajeriadelyaqui@hotmail.com',
      `edgardolugo@paqueteriaymensajeriadelyaqui.com, gerardorobles@paqueteriaymensajeriadelyaqui.com, sistemas@paqueteriaymensajeriadelyaqui.com, ${subsidiary.officeEmail}, ${subsidiary.officeEmailToCopy}`
    );  

    try {
      return await this.mailerService.sendMail({
        to,
        cc,
        subject: `🚨🚥 Paquetes con status DEX03 de ${subsidiary.name.toUpperCase()}`,
        html: htmlContent,
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
    const timeZone = 'America/Hermosillo'; 

    const attachments = [
      {
        filename: file.originalname,
        content: file.buffer
      },
      {
        filename: excelFile.originalname,
        content: excelFile.buffer
      }
    ]

    const now = new Date();
    const zonedDate = toZonedTime(now, timeZone);
    const formattedDate = format(zonedDate, "dd-MM-yyyy");

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; color: #2c3e50; max-width: 800px; margin: auto;">
        <h2 style="border-bottom: 3px solid #3498db; padding-bottom: 8px;">
          🚚 Reporte de Cierre de Ruta
          
        </h2>

        <p>
          Se ha generado un nuevo reporte de <strong>Cierre de Ruta</strong> para la sucursal <strong>${routeClosure.subsidiary.name}</strong>.
        </p>

        <p style="margin-top: 20px;">
          Puede consultar más detalles en: 
          <a href="https://app-pmy.vercel.app/" target="_blank" style="color: #2980b9; text-decoration: none;">
            https://app-pmy.vercel.app/
          </a>
        </p>

        <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;" />

        <p style="font-size: 0.9em; color: #7f8c8d;">
          Este correo fue enviado automáticamente por el sistema.<br />
          Por favor, no responda a este mensaje.
        </p>
      </div>
    `;

    const { to, cc } = this.applyDevFilters(
      routeClosure.subsidiary.officeEmail,
      `${routeClosure.subsidiary.officeEmailToCopy}, sistemas@paqueteriaymensajeriadelyaqui.com`
    );

    try {
      const emailSent = await this.mailerService.sendMail({
        to,
        cc,
        //to: 'javier.rappaz@gmail.com',
        subject: `🚚 CIERRE DE RUTA - ${routeClosure.packageDispatch.drivers[0].name.toUpperCase()} - ${formattedDate} DE ${routeClosure.subsidiary.name.toUpperCase()}`,
        html: htmlContent,
        headers: {
        },
        attachments: attachments
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
    const timeZone = 'America/Hermosillo'; 

    const attachments = [
      {
        filename: file.originalname,
        content: file.buffer
      },
      {
        filename: excelFile.originalname,
        content: excelFile.buffer
      }
    ]

    const now = new Date();
    const zonedDate = toZonedTime(now, timeZone);
    const formattedDate = format(zonedDate, "dd-MM-yyyy");

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; color: #2c3e50; max-width: 800px; margin: auto;">
        <h2 style="border-bottom: 3px solid #3498db; padding-bottom: 8px;">
          📦 Reporte de Inventario
          
        </h2>

        <p>
          Se ha generado un nuevo reporte de <strong>Inventario</strong> para la sucursal <strong>${subsidiaryName}</strong>.
        </p>

        <p><strong>Fecha y hora:</strong> ${format(toZonedTime(inventory.inventoryDate, timeZone), 'dd/MM/yyyy hh:mm aa')}</p>
      
        <p style="margin-top: 20px;">
          Puede consultar más detalles utilizando el Número de seguimiento <strong>${inventory.trackingNumber}</strong> en: 
          <a href="https://app-pmy.vercel.app/" target="_blank" style="color: #2980b9; text-decoration: none;">
            https://app-pmy.vercel.app/
          </a>
        </p>

        <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;" />

        <p style="font-size: 0.9em; color: #7f8c8d;">
          Este correo fue enviado automáticamente por el sistema.<br />
          Por favor, no responda a este mensaje.
        </p>
      </div>
    `;

    const { to, cc } = this.applyDevFilters(
      inventory.subsidiary.officeEmail,
      `${inventory.subsidiary.officeEmailToCopy}, sistemas@paqueteriaymensajeriadelyaqui.com`
    );

    try {
      await this.mailerService.sendMail({
        to,
        cc,
        subject: `📦 Inventario ${formattedDate} de ${subsidiaryName}`,
        html: htmlContent,
        headers: {
        },
        attachments: attachments
      })

    } catch (error) {
      console.log(error);
      throw error;
    }
  }

  /** Enviar correo de prioridades dentro de Inventario */
  async sendHighPriorityPackagesOnInvetory(options: { to: string | string[], cc?: string | string[], htmlContent: string }) {
    const { to, cc } = this.applyDevFilters(options.to, options.cc);
    
    try {
      await this.mailerService.sendMail({
        to,
        cc,
        subject: '🔴 Envíos con Prioridad Alta en Inventario',
        html: options.htmlContent,
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

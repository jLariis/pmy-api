import { Injectable } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { PackageDispatch } from 'src/entities/package-dispatch.entity';
import { Unloading } from 'src/entities/unloading.entity';
import { ShipmentStatusForReportDto } from './dtos/shipment.dto';

@Injectable()
export class MailService {
  constructor(private readonly mailerService: MailerService) {}

  async sendHighPriorityShipmentsEmail(options: { to: string | string[], cc?: string | string[], htmlContent: string }) {
    const { to, cc, htmlContent } = options;
    
    try {
      await this.mailerService.sendMail({
        to,
        cc,
        subject: '🔴 Envíos con Prioridad Alta en Curso',
        html: htmlContent,
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

        <p style="margin-top: 20px;">A continuación se detalla la información correspondiente a los paquetes incluidos:</p>

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

    try {
      await this.mailerService.sendMail({
        to: 'paqueteriaymensajeriadelyaqui@hotmail.com',
        cc: 'sistemas@paqueteriaymensajeriadelyaqui.com',
        //to: 'javier.rappaz@gmail.com',
        subject: `🚚 Salida a Ruta ${formattedDate} de ${subsidiaryName}`,
        html: htmlContent,
        headers: {
          'X-Priority': '1',
          'X-MSMail-Priority': 'High',
          Importance: 'High',
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
          Se ha generado un nuevo reporte de <strong>Desembarque</strong> para la sucursal <strong>${subsidiaryName}</strong> saliendo en la unidad <strong>${unloading.vehicle.name}</strong>.
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

    try {
      await this.mailerService.sendMail({
        to: 'paqueteriaymensajeriadelyaqui@hotmail.com',
        cc: 'sistemas@paqueteriaymensajeriadelyaqui.com',
        //to: 'javier.rappaz@gmail.com',
        subject: `🚚 Desembarque ${formattedDate} de ${subsidiaryName}`,
        html: htmlContent,
        headers: {
          'X-Priority': '1',
          'X-MSMail-Priority': 'High',
          Importance: 'High',
        },
        attachments: attachments
      })

    } catch (error) {
      console.log(error);
      throw error;
    }
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


  /*** Correos de DEX03 - Reporte */
  async sendHighPriorityShipmentWithStatus03(
    subsidiaryName: string,
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
            <td style="padding: 8px; text-align: center;">${this.formatMexicanPhoneNumber(s.recipientPhone)}</td>
          </tr>
        `
        )
        .join('');

    const htmlContent = `
        <div style="font-family: Arial, sans-serif; color: #2c3e50; max-width: 800px; margin: auto;">
          <h2 style="border-bottom: 3px solid #e74c3c; padding-bottom: 8px;">
            Reporte de Paquetes con DEX03
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

    try {
      return await this.mailerService.sendMail({
        to: 'paqueteriaymensajeriadelyaqui@hotmail.com',
        cc: 'edgardolugo@paqueteriaymensajeriadelyaqui.com, gerardorobles@paqueteriaymensajeriadelyaqui.com, sistemas@paqueteriaymensajeriadelyaqui.com',
        subject: `🚨🚥 Paquetes con status DEX03 de ${subsidiaryName}`,
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
}

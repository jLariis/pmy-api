import { Injectable } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { PackageDispatch } from 'src/entities/package-dispatch.entity';

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

  async sendHighPriorityPackageDispatchEmail(
    file: Express.Multer.File, 
    subsidiaryName: string,
    packageDispatch: PackageDispatch
  ) {
    const timeZone = 'America/Hermosillo'; 

    const attachment = {
      filename: file.originalname,
      content: file.buffer
    }

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
        to: 'javier.rappaz@gmail.com',
        //cc: '',
        subject: `🚚 Salida a Ruta ${formattedDate} de ${subsidiaryName}`,
        html: htmlContent,
        headers: {
          'X-Priority': '1',
          'X-MSMail-Priority': 'High',
          Importance: 'High',
        },
        attachments: [attachment]
      })

    } catch (error) {
      console.log(error);
      throw error;
    }
  }
}

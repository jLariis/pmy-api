import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Configuración del envío de avisos por WhatsApp (singleton: una sola fila).
 * El envío es GRATIS y controlado por nosotros vía gateway propio. El número
 * destino y la plantilla ya NO viven aquí: el número se elige al enviar
 * (custom / chofer / encargado) y las plantillas están en `whatsapp_templates`.
 * Aquí solo queda el interruptor general del feature.
 */
@Entity('whatsapp_settings')
export class WhatsappSettings {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Interruptor general del feature. */
  @Column({ default: true })
  enabled: boolean;

  @Column({ type: 'datetime', nullable: true })
  updatedAt: Date;
}

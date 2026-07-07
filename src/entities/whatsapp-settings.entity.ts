import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Configuración del envío de avisos por WhatsApp al chofer (singleton: una sola
 * fila). El envío es GRATIS y controlado por nosotros: no usa API de pago, sino
 * el link click-to-chat de WhatsApp (wa.me) que el usuario confirma. Aquí se
 * guarda a qué número se manda, la plantilla del mensaje por defecto y si está
 * activo — todo editable desde la sección de Configuración.
 */
@Entity('whatsapp_settings')
export class WhatsappSettings {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Interruptor general del feature. */
  @Column({ default: true })
  enabled: boolean;

  /**
   * Número destino en formato internacional SIN "+" ni espacios (ej.
   * "526444230374"). Por ahora es un solo número fijo para todos los choferes.
   */
  @Column({ default: '' })
  driverPhone: string;

  /**
   * Plantilla del mensaje por defecto. Soporta placeholders que el frontend
   * reemplaza con los datos de la parada: {cliente} {direccion} {cp} {guias}
   * {vence} {ruta} {chofer}.
   */
  @Column({ type: 'text' })
  messageTemplate: string;

  @Column({ type: 'datetime', nullable: true })
  updatedAt: Date;
}

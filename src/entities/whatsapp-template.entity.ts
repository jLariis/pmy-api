import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Plantilla de mensaje de WhatsApp editable desde Configuración. El número
 * destino NO vive aquí: se elige al enviar (custom / chofer / encargado).
 */
@Entity('whatsapp_templates')
export class WhatsappTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Clave estable para buscar la plantilla (ej. 'salida_ruta'). */
  @Column({ unique: true })
  key: string;

  @Column()
  name: string;

  /** Cuerpo con placeholders {…} que el frontend reemplaza. */
  @Column({ type: 'text' })
  body: string;

  @Column({ default: true })
  active: boolean;

  @Column({ type: 'datetime', nullable: true })
  updatedAt: Date;
}

import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { EmailStatus } from 'src/common/enums/email-status.enum';

/**
 * Bitácora genérica de envíos de correo. Un renglón por CADA intento (primer
 * envío + cada reenvío). No conoce el módulo origen: se referencia de forma
 * polimórfica por (`module`, `entityId`) sin FK dura, para poder adoptarse en
 * cualquier módulo. Piloto: `module = 'package_dispatch'`.
 */
@Entity('email_log')
@Index('IDX_email_log_entity', ['module', 'entityId', 'createdAt'])
export class EmailLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Discriminador del módulo origen, p.ej. 'package_dispatch'. */
  @Column({ type: 'varchar', length: 64 })
  module: string;

  /**
   * Tipo/origen del correo (de dónde salió): 'route_dispatch' (salida a ruta),
   * 'unloading' (desembarque), 'route_closure' (cierre de ruta), 'inventory',
   * 'devolutions', etc. Suele coincidir con la clave de plantilla.
   */
  @Column({ type: 'varchar', length: 64, default: 'unknown' })
  emailType: string;

  /** Id de la entidad origen (uuid del despacho, etc.). */
  @Column({ type: 'varchar', length: 36 })
  entityId: string;

  /** Folio/guía legible de la entidad origen (p.ej. trackingNumber del despacho). */
  @Column({ type: 'varchar', length: 255, nullable: true })
  referenceTracking: string | null;

  /** Sucursal a la que corresponde el correo. */
  @Column({ type: 'varchar', length: 36, nullable: true })
  subsidiaryId: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  subsidiaryName: string | null;

  /** Destinatarios reales usados (ya con el filtro de ambiente aplicado). */
  @Column({ type: 'text' })
  to: string;

  @Column({ type: 'text', nullable: true })
  cc: string | null;

  @Column({ type: 'varchar', length: 255 })
  subject: string;

  @Column({ type: 'enum', enum: EmailStatus })
  status: EmailStatus;

  /** Mensaje completo del error cuando `status = ERROR`. */
  @Column({ type: 'text', nullable: true })
  error: string | null;

  /** messageId devuelto por el SMTP (si hubo). */
  @Column({ type: 'varchar', length: 255, nullable: true })
  messageId: string | null;

  /** Direcciones rechazadas por el SMTP (si hubo), separadas por coma. */
  @Column({ type: 'text', nullable: true })
  rejected: string | null;

  @Column({ type: 'boolean', default: false })
  isResend: boolean;

  /** Usuario que realizó el envío/reenvío. */
  @Column({ type: 'varchar', length: 36, nullable: true })
  triggeredById: string | null;

  /** Nombre del usuario que lo realizó (denormalizado para mostrar sin joins). */
  @Column({ type: 'varchar', length: 255, nullable: true })
  triggeredByName: string | null;

  /** Metadatos de adjuntos para mostrar sin leer los bytes: [{ filename, size }]. */
  @Column({ type: 'json', nullable: true })
  attachmentsMeta: { filename: string; size: number }[] | null;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}

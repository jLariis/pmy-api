import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Supplier } from './supplier.entity';
import { CONTACT_CHANNELS, ContactChannel } from './supplier-contact.entity';

/** Envío de una solicitud de cotización a un proveedor (correo o WhatsApp). Una fila por intento. */
@Entity('request_dispatch')
export class RequestDispatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 36 })
  requestId: string;

  @ManyToOne(() => Supplier, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'supplierId' })
  supplier: Supplier;

  @Column({ length: 36 })
  supplierId: string;

  @Column({ type: 'enum', enum: CONTACT_CHANNELS })
  channel: ContactChannel;

  @Column({ length: 200 })
  destination: string;

  @Column({ type: 'enum', enum: ['enviado', 'error'] })
  status: 'enviado' | 'error';

  @Column({ length: 20, default: 'rfq' })
  kind: string;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ length: 36, nullable: true })
  emailLogId: string | null;

  @Column({ length: 36, nullable: true })
  sentById: string | null;

  @Column({ length: 150, nullable: true })
  sentByName: string | null;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  sentAt: Date;
}

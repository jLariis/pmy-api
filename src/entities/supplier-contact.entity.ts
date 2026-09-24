import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Supplier } from './supplier.entity';

export const CONTACT_CHANNELS = ['email', 'whatsapp'] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

/** Contacto del proveedor. El `isDefault` recibe las órdenes por su `preferredChannel`. */
@Entity('supplier_contact')
export class SupplierContact {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Supplier, (s) => s.contacts, { onDelete: 'CASCADE', createForeignKeyConstraints: false, orphanedRowAction: 'delete' })
  @JoinColumn({ name: 'supplierId' })
  supplier: Supplier;

  @Column({ length: 36 })
  supplierId: string;

  @Column({ length: 150 })
  name: string;

  @Column({ length: 100, nullable: true })
  position: string | null;

  @Column({ length: 150, nullable: true })
  email: string | null;

  @Column({ length: 30, nullable: true })
  phone: string | null;

  @Column({ length: 30, nullable: true })
  whatsapp: string | null;

  @Column({ type: 'enum', enum: CONTACT_CHANNELS, default: 'email' })
  preferredChannel: ContactChannel;

  @Column({ default: false })
  isDefault: boolean;
}

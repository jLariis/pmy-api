import { Column, DeleteDateColumn, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { SupplierContact } from './supplier-contact.entity';

/** Proveedor de mantenimiento (taller, refaccionaria, llantera…). */
@Entity('supplier')
export class Supplier {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 200 })
  name: string;

  @Column({ length: 20, nullable: true })
  rfc: string | null;

  @Column({ length: 300, nullable: true })
  address: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ length: 100, nullable: true })
  bankName: string | null;

  /** CLABE interbancaria (18 dígitos, validada con dígito verificador). */
  @Column({ length: 18, nullable: true })
  clabe: string | null;

  @Column({ length: 30, nullable: true })
  accountNumber: string | null;

  @Column({ default: true })
  active: boolean;

  @OneToMany(() => SupplierContact, (c) => c.supplier, { cascade: true })
  contacts: SupplierContact[];

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ type: 'datetime', nullable: true })
  updatedAt: Date | null;

  @DeleteDateColumn({ type: 'datetime', nullable: true })
  deletedAt: Date | null;
}

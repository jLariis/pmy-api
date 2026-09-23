import { Column, DeleteDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { VehicleTypeEnum } from 'src/common/enums/vehicle-type.enum';
import { decimalTransformer } from 'src/common/transformers/decimal.transformer';
import { MaintenanceServiceCategory } from './maintenance-service-category.entity';

export const MAINTENANCE_SERVICE_UNITS = ['servicio', 'pieza', 'litro', 'juego'] as const;
export type MaintenanceServiceUnit = (typeof MAINTENANCE_SERVICE_UNITS)[number];

/** Servicio/refacción del catálogo con precio de referencia. */
@Entity('maintenance_service')
export class MaintenanceService {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 150 })
  name: string;

  @ManyToOne(() => MaintenanceServiceCategory, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'categoryId' })
  category: MaintenanceServiceCategory;

  @Column({ length: 36 })
  categoryId: string;

  @Column({ type: 'enum', enum: MAINTENANCE_SERVICE_UNITS, default: 'servicio' })
  unit: MaintenanceServiceUnit;

  @Column('decimal', { precision: 12, scale: 2, default: 0, transformer: decimalTransformer })
  referencePrice: number;

  /** null = aplica a todos los tipos de vehículo. */
  @Column({ type: 'enum', enum: VehicleTypeEnum, nullable: true })
  vehicleType: VehicleTypeEnum | null;

  @Column({ default: true })
  active: boolean;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ type: 'datetime', nullable: true })
  updatedAt: Date | null;

  @DeleteDateColumn({ type: 'datetime', nullable: true })
  deletedAt: Date | null;
}

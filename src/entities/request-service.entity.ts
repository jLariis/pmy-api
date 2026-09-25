import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { MaintenanceRequest } from './maintenance-request.entity';
import { ServiceTemplate } from './service-template.entity';

/** Servicio predefinido elegido en una solicitud. */
@Entity('request_service')
export class RequestSelectedService {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => MaintenanceRequest, (r) => r.services, { onDelete: 'CASCADE', createForeignKeyConstraints: false })
  @JoinColumn({ name: 'requestId' })
  request: MaintenanceRequest;

  @Column({ length: 36 })
  requestId: string;

  @ManyToOne(() => ServiceTemplate, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'serviceTemplateId' })
  serviceTemplate: ServiceTemplate;

  @Column({ length: 36 })
  serviceTemplateId: string;

  @Column({ default: 0 })
  sortOrder: number;
}

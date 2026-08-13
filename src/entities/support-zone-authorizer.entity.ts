import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Autorizador de soporte por zona: un usuario que puede aprobar/rechazar las
 * mejoras cuyos tickets pertenecen a esa zona (zona = `subsidiary.zoneId`).
 * Varios autorizadores por zona; basta que uno apruebe.
 */
@Entity('support_zone_authorizer')
@Index(['zoneId'])
@Index(['zoneId', 'userId'], { unique: true })
export class SupportZoneAuthorizer {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ type: 'char', length: 36 }) zoneId: string;
  @Column({ type: 'char', length: 36 }) userId: string;
  @Column({ type: 'varchar', length: 160, nullable: true }) userName: string | null;
  @Column({ type: 'varchar', length: 160, nullable: true }) userEmail: string | null;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' }) createdAt: Date;
}

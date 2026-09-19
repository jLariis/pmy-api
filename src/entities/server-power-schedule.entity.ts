import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('server_power_schedule')
export class ServerPowerSchedule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  /** HH:MM en hora local del servidor. */
  @Column({ type: 'varchar', length: 5, default: '21:30' })
  suspendTime: string;

  /** HH:MM en hora local del servidor. */
  @Column({ type: 'varchar', length: 5, default: '06:00' })
  wakeTime: string;

  /** Destinatarios de las alertas. */
  @Column({ type: 'json', nullable: true })
  recipients: string[] | null;

  @Column({ type: 'datetime', nullable: true })
  lastAppliedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  lastApplyError: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  updatedById: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

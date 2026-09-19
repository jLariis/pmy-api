import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Una fila por día de la semana. dayOfWeek: 1=Lun … 7=Dom. */
@Entity('server_power_day')
export class ServerPowerDay {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'tinyint' })
  dayOfWeek: number;

  /** ¿Se suspende esa noche? */
  @Column({ type: 'boolean', default: true })
  active: boolean;
}

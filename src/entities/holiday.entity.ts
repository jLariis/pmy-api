import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Día festivo ADICIONAL definido por el usuario (global, todas las sucursales).
 *
 * Complementa la lista fija del Art. 74 LFT que vive en `sunday-holiday.util.ts`.
 * El sobreprecio de cargas en domingo/festivo (ver `resolveChargeCost`) aplica tanto
 * a los feriados fijos + domingos como a estos días capturados aquí.
 *
 *  - `date`      = 'YYYY-MM-DD'. Si `recurring` es true solo importan mes-día.
 *  - `recurring` = true → aplica cada año en ese mes-día; false → solo esa fecha exacta.
 */
@Entity('holiday')
export class Holiday {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Index()
  @Column({ type: 'date' })
  date: string;

  @Column({ default: false })
  recurring: boolean;

  @Column({ type: 'char', length: 36, nullable: true })
  createdById: string | null;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}

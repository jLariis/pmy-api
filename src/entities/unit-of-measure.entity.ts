import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Presentación / unidad de medida (Pieza, Litro, Galón, Cubeta, Juego…). */
@Entity('unit_of_measure')
export class UnitOfMeasure {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 60, unique: true })
  name: string;

  @Column({ length: 15, nullable: true })
  abbreviation: string | null;

  @Column({ default: true })
  active: boolean;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}

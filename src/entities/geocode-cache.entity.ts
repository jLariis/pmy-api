import { Column, Entity, Index, PrimaryGeneratedColumn, BeforeInsert, BeforeUpdate } from 'typeorm';

/**
 * Caché PERSISTENTE de geocodificación ("ML casero"). Cada dirección resuelta se
 * guarda aquí; la próxima vez se sirve desde la BD sin pegarle a Nominatim. Las
 * correcciones MANUALES del usuario (`manual=true`) son verdad de campo y SIEMPRE
 * ganan sobre lo que devuelva Nominatim.
 */
@Entity('geocode_cache')
export class GeocodeCache {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Clave normalizada: `address|city|zip` en minúsculas y sin acentos. */
  @Index({ unique: true })
  @Column()
  cacheKey: string;

  @Column({ nullable: true })
  rawAddress: string;

  @Column({ nullable: true })
  city: string;

  @Column({ nullable: true })
  zip: string;

  @Column({ type: 'decimal', precision: 10, scale: 7 })
  latitude: number;

  @Column({ type: 'decimal', precision: 10, scale: 7 })
  longitude: number;

  /** address | postalcode | city | manual */
  @Column({ default: 'address' })
  source: string;

  /** Corregida a mano por el usuario en el mapa → confianza máxima. */
  @Column({ default: false })
  manual: boolean;

  /** Veces que se ha servido desde caché (señal de uso). */
  @Column({ default: 1 })
  hits: number;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ type: 'datetime', nullable: true })
  updatedAt: Date;

  @BeforeInsert()
  setCreatedAt() { this.createdAt = new Date(); }

  @BeforeUpdate()
  setUpdatedAt() { this.updatedAt = new Date(); }
}

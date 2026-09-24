import { Column, Entity, PrimaryColumn } from 'typeorm';

/** Contador transaccional de folios (SM = solicitud, OC = orden de compra). */
@Entity('maintenance_folio_counter')
export class MaintenanceFolioCounter {
  @PrimaryColumn({ length: 10 })
  prefix: string;

  @Column({ type: 'int', default: 0 })
  lastValue: number;
}

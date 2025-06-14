import { BeforeInsert, Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Subsidiary } from './subsidiary.entity';
import { ShipmentType } from 'src/common/enums/shipment-type.enum';
import { IncomeStatus } from 'src/common/enums/income-status.enum';

@Entity('income')
export class Income {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  trackingNumber: string;

  @ManyToOne(() => Subsidiary, { nullable: true })
  @JoinColumn({ name: 'subsidiaryId' })
  subsidiary: Subsidiary;

  @Column({ nullable: true })
  subsidiaryId: string;

  @Column()
  shipmentType: ShipmentType;

  @Column('decimal', { precision: 10, scale: 2, nullable: false })
  cost: number;

  /** entregado, no_entregado */
  @Column({nullable: false})
  incomeType: IncomeStatus;

  /** no_entregado: 07-08-17 solo esos códigos - un 14 encontre también */
  @Column({nullable: true, default: ''})
  notDeliveryStatus: string

  @Column({nullable: true, default: false})
  isPartOfCharge: boolean

  @Column()
  date: Date;

  @Column({nullable: true})
  createdAt: string;

  @BeforeInsert()
    setDefaults() {
      const now = new Date();
      this.createdAt = now.toISOString();
    }


}


/**** 
trackingNumber
sucursal
status - Entregado o No entregado
subStatus - 07 - 08 - 17
empresa - Fedex o DHl
esCarga 
costo
fecha
*/
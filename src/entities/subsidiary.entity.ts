import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('subsidiary')
export class Subsidiary {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  address?: string;

  @Column({ nullable: true })
  phone?: string;

  @Column({ default: true })
  active: boolean;

  @Column({ default: '', nullable: true})
  officeManager: string;

  @Column({ default: '', nullable: true})
  managerPhone: string;


  @Column({
    type: "decimal",
    precision: 10,
    scale: 2,
    default: 0.00
  })
  fedexCostPackage: string;

  @Column({
    type: "decimal",
    precision: 10,
    scale: 2,
    default: 0.00
  })
  dhlCostPackage: string;
}

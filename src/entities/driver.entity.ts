import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('driver')
export class Driver {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column()
  licenseNumber: string;

  @Column()
  phoneNumber: string;

  @Column()
  status: 'active' | 'inactive';
}

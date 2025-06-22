import { Column, Entity, ManyToOne, PrimaryGeneratedColumn, JoinColumn } from 'typeorm';
import { Subsidiary } from './subsidiary.entity';
import { Exclude } from 'class-transformer';

@Entity('user')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column()
  @Exclude()
  password: string;

  @Column({ nullable: true })
  name?: string;

  @Column({ nullable: true })
  lastName?: string;

  @Column({ default: 'user' })
  role: 'admin' | 'user';

  @ManyToOne(() => Subsidiary, { nullable: true })
  @JoinColumn({ name: 'subsidiaryId' })
  subsidiary: Subsidiary;

  @Column({ nullable: true })
  subsidiaryId: string;

  @Column({ nullable: true })
  avatar?: string;

  @Column({nullable: true, default: true})
  active: boolean;

}



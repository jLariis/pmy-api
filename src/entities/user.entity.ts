import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  BeforeInsert,
  BeforeUpdate,
} from 'typeorm';
import { Exclude } from 'class-transformer';
import { Subsidiary } from './subsidiary.entity';

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
  //@Exclude() // Evitar serializar el objeto Subsidiary
  subsidiary: Subsidiary;

  @Column({ nullable: true })
  avatar?: string;

  @Column({ nullable: true, default: true })
  active: boolean;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ type: 'datetime', nullable: true })
  updatedAt: Date;

  @BeforeInsert()
  setCreatedAt() {
    this.createdAt = new Date(); // Fecha en UTC
  }

  @BeforeUpdate()
  setUpdatedAt() {
    this.updatedAt = new Date(); // Fecha en UTC
  }
}
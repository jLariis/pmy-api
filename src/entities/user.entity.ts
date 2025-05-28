import { Column, Entity, ManyToMany, JoinTable, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Role } from './role.entity';
import { Subsidiary } from './subsidiary.entity';

@Entity('user')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column()
  password: string;

  @Column({ nullable: true })
  name?: string;

  @Column({ nullable: true })
  lastName?: string;

  @Column({ default: 'user' })
  role: 'admin' | 'user';

  @ManyToOne(() => Subsidiary, subsidiary => subsidiary.users, { nullable: true })
  subsidiary?: Subsidiary;

  @ManyToMany(() => Role, role => role.users)
  @JoinTable()
  roles: Role[];

  @Column('simple-array', { nullable: true })
  permissions?: string[];

  @Column({ nullable: true })
  avatar?: string;
}

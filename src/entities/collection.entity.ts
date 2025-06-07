import { BeforeInsert, Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { Subsidiary } from "./subsidiary.entity";

@Entity('collection')
export class Collection {
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
    status: string;

    @Column()
    isPickUp: boolean;

    @Column({nullable: true})
    createdAt: string;

    @BeforeInsert()
    setDefaults() {
      const now = new Date();
      this.createdAt = now.toISOString();
    }
}
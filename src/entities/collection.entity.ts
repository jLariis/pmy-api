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
      now.setHours(0, 0, 0, 0);
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      this.createdAt = `${yyyy}-${mm}-${dd}`; // "YYYY-MM-DD"
    }
}
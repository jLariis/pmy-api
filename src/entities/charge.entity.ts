import { PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, BeforeInsert, Entity } from "typeorm";
import { Subsidiary } from "./subsidiary.entity";

@Entity('charge')
export class Charge{
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    chargeDate: string;
    
    @Column({nullable: false})
    numberOfPackages: number;
    
    @ManyToOne(() => Subsidiary, { nullable: true })
    @JoinColumn({ name: 'subsidiaryId' })
    subsidiary: Subsidiary;

    @Column({ nullable: true })
    subsidiaryId: string;

    @Column({ default: false})
    isChargeComplete: boolean;

    @Column({nullable: true})
    createdAt: string;

    @BeforeInsert()
    setDefaults() {
        const now = new Date();
        this.createdAt = now.toISOString();
    }
}
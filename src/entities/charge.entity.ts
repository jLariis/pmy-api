import { PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, BeforeInsert, Entity } from "typeorm";
import { Subsidiary } from "./subsidiary.entity";

@Entity('charge')
export class Charge{
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    @Column({ type: 'datetime' })
    chargeDate: Date;
    
    @Column({nullable: false})
    numberOfPackages: number;
    
    @ManyToOne(() => Subsidiary, { nullable: true })
    @JoinColumn({ name: 'subsidiaryId' })
    subsidiary: Subsidiary;

    @Column({ default: false})
    isChargeComplete: boolean;

    @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
    createdAt: Date;

    @Column({nullable: true, default: ''})
    consNumber: string;

    @BeforeInsert()
    setDefaults() {
        const now = new Date();
        this.createdAt = now;
    }
}
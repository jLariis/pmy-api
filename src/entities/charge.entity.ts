import { PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, BeforeInsert, Entity } from "typeorm";
import { Subsidiary } from "./subsidiary.entity";
import { User } from "./user.entity";

@Entity('charge')
export class Charge{
    @PrimaryGeneratedColumn('uuid')
    id: string;

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

    @ManyToOne(() => User, { nullable: true })
    @JoinColumn({ name: 'createdById' })
    createdBy: User;

    @Column({ nullable: true })
    createdById: string;

    @BeforeInsert()
    setDefaults() {
        const now = new Date();
        this.createdAt = now;
    }
}
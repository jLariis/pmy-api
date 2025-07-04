import { BeforeInsert, Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { Subsidiary } from "./subsidiary.entity";
import { ConsolidatedType } from "src/common/enums/consolidated-type.enum";

@Entity('consolidated')
export class Consolidated {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    date: string;

    @Column({
        type: 'enum',
        enum: ConsolidatedType,
        default: ConsolidatedType.ORDINARIA,
    })
    type: ConsolidatedType;
    
    @Column()
    numberOfPackages: number;
    
    @ManyToOne(() => Subsidiary, { nullable: true })
    @JoinColumn({ name: 'subsidiaryId' })
    subsidiary: Subsidiary;

    @Column({ nullable: true })
    subsidiaryId: string;
    
    @Column()
    isCompleted: boolean;
    
    @Column({nullable: true})
    consNumber: string;

    @Column({nullable: true, default: 0})
    efficiency: number;

    @Column({nullable: true})
    createdAt: string;

    @BeforeInsert()
    setDefaults() {
        const now = new Date();
        this.createdAt = now.toISOString();
    }
}
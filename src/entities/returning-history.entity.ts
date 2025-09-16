import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from "typeorm";
import { Devolution } from "./devolution.entity";
import { Collection } from "./collection.entity";

@Entity('returning_history')
export class ReturningHistory {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'timestamp'})
    date: Date;

    @OneToMany(() => Devolution, (devolution) => devolution.returningHistory)
    devolutions: Devolution[]

    @OneToMany(() => Collection, (collection) => collection.returningHistory)
    collections: Collection[]
}
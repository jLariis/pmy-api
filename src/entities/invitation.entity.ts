import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity('invitation')
export class Invitation {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    name: string;

    @Column({ type: 'timestamp', precision: 0 })
    invitationDate: Date;

    @Column({ type: 'timestamp', precision: 0 })
    expirationDate: Date;

    @Column()
    userId: string;
}
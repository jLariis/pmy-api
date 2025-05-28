import { Subsidiary } from './subsidiary.entity';
export declare class RouteIncome {
    id: string;
    subsidiary: Subsidiary;
    date: Date;
    ok: number;
    ba: number;
    collections: number;
    total: number;
    totalIncome: number;
}

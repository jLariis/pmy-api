import { RouteIncome } from './route-income.entity';
import { Expense } from './expense.entity';
import { User } from './user.entity';
export declare class Subsidiary {
    id: string;
    name: string;
    address?: string;
    phone?: string;
    active: boolean;
    incomes: RouteIncome[];
    expenses: Expense[];
    users: User[];
}

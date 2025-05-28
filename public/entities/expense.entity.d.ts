import { Subsidiary } from './subsidiary.entity';
import { ExpenseCategory } from './expense-category.entity';
export declare class Expense {
    id: string;
    subsidiary: Subsidiary;
    category: ExpenseCategory;
    date: Date;
    amount: number;
    description?: string;
    paymentMethod?: string;
    responsible?: string;
    notes?: string;
    receiptUrl?: string;
}

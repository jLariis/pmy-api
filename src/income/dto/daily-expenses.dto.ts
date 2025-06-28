import { Expense } from "src/entities";

export interface DailyExpenses {
  date: string;        // e.g. "2025-06-27"
  total: number;       // suma de todos los gastos de ese día
  items: Expense[];    // array de los registros de ese día
}
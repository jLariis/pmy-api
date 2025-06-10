import { startOfMonth, endOfMonth } from "date-fns";

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2
  }).format(amount);
}

export function getWeekRange() {
  const now = new Date();
  const currentDay = now.getDay(); // 0=domingo, 1=lunes...
  const diffToMonday = currentDay === 0 ? -6 : 1 - currentDay;
  
  const startDate = new Date(now);
  startDate.setDate(now.getDate() + diffToMonday);
  startDate.setHours(0, 0, 0, 0);
  
  const endDate = new Date(startDate);
  endDate.setDate(startDate.getDate() + 6);
  endDate.setHours(23, 59, 59, 999);

  return { startDate, endDate };
}

export function getStartAndEndOfMonth(date: Date): { start: Date; end: Date } {
  const start = startOfMonth(date);
  const end = endOfMonth(date);
  return { start, end };
}
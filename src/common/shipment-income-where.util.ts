import { FindOptionsWhere, IsNull } from 'typeorm';
import { Income } from '../entities/income.entity';

/**
 * Filtro de "¿este paquete ya tiene ingreso?". El ingreso le pertenece al SHIPMENT, no a la guía:
 * cada consolidado crea un registro nuevo (flujo nuevo), así que lo que cobró o anuló un registro
 * anterior de la misma guía NO cuenta (caso 878249671370, ruta 604005759064, 10-oct-2026).
 *
 * Regresa un OR: los ingresos VIVOS ligados a ese shipment y, para no cobrar doble, los vivos de
 * la misma guía SIN shipment (altas viejas/manuales sin liga). `extra` se aplica a ambas ramas
 * (sourceType, incomeType, ventana de fechas…).
 */
export function shipmentIncomeWhere(
  shipmentId: string,
  trackingNumber: string,
  extra: FindOptionsWhere<Income> = {},
): FindOptionsWhere<Income>[] {
  const base = { ...extra, active: true };
  return [
    // Por columna, no por relación: `shipment: { id }` mete un join que vuelve lenta la consulta.
    { ...base, shipmentId },
    { ...base, trackingNumber, shipmentId: IsNull() },
  ];
}

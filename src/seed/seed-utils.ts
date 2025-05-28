import { DataSource } from 'typeorm';
import {
  initialUsers,
  initialPermissions,
  initialRoles,
  initialSubsidiaries,
  initialExpenseCategories,
  initialExpenses,
  initialDrivers,
  initialVehicles,
  initialRoutes,
  initialShipments,
} from './seed-data';

export async function runSeeds(dataSource: DataSource) {
  console.log('📦 Insertando datos...');

  await dataSource.getRepository('user').save(initialUsers);
  await dataSource.getRepository('permission').save(initialPermissions);
  await dataSource.getRepository('role').save(initialRoles);
  await dataSource.getRepository('subsidiary').save(initialSubsidiaries);
  await dataSource.getRepository('expense_category').save(initialExpenseCategories);
  await dataSource.getRepository('expense').save(initialExpenses);
  await dataSource.getRepository('driver').save(initialDrivers);
  await dataSource.getRepository('vehicle').save(initialVehicles);
  await dataSource.getRepository('route').save(initialRoutes);

  for (const shipment of initialShipments) {
    const savedShipment = await dataSource.getRepository('shipment').save(shipment);
    if (shipment.payment) {
      await dataSource.getRepository('payment').save({
        ...shipment.payment,
        shipment: savedShipment,
      });
    }
    if (shipment.statusHistory) {
      for (const status of shipment.statusHistory) {
        await dataSource.getRepository('shipment_status').save({
          ...status,
          shipment: savedShipment,
        });
      }
    }
  }

  console.log('✅ Seeds completados');
}
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runSeeds = runSeeds;
const seed_data_1 = require("./seed-data");
async function runSeeds(dataSource) {
    console.log('📦 Insertando datos...');
    await dataSource.getRepository('user').save(seed_data_1.initialUsers);
    await dataSource.getRepository('permission').save(seed_data_1.initialPermissions);
    await dataSource.getRepository('role').save(seed_data_1.initialRoles);
    await dataSource.getRepository('subsidiary').save(seed_data_1.initialSubsidiaries);
    await dataSource.getRepository('expense_category').save(seed_data_1.initialExpenseCategories);
    await dataSource.getRepository('expense').save(seed_data_1.initialExpenses);
    await dataSource.getRepository('driver').save(seed_data_1.initialDrivers);
    await dataSource.getRepository('vehicle').save(seed_data_1.initialVehicles);
    await dataSource.getRepository('route').save(seed_data_1.initialRoutes);
    for (const shipment of seed_data_1.initialShipments) {
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
//# sourceMappingURL=seed-utils.js.map
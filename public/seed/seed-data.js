"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initialRoutes = exports.initialDrivers = exports.initialExpenses = exports.initialExpenseCategories = exports.initialSubsidiaries = exports.initialRoles = exports.initialPermissions = exports.initialUsers = exports.initialVehicles = exports.initialShipments = void 0;
exports.initialShipments = [
    {
        trackingNumber: 'ABC123',
        recipientName: 'Juan Pérez',
        recipientAddress: 'Av. Siempre Viva 123',
        recipientCity: 'Ciudad Obregón',
        recipientZip: '85000',
        commitDate: '2025-06-01',
        commitTime: '15:30',
        recipientPhone: '+526441234567',
        priority: 'media',
        status: 'pendiente',
        payment: {
            amount: 150.50,
            status: 'pending',
        },
        statusHistory: [
            {
                status: 'recoleccion',
                timestamp: new Date().toISOString(),
                notes: 'Paquete recolectado en punto A',
            },
        ],
    },
];
exports.initialVehicles = [
    {
        plateNumber: 'VHL123',
        model: 'Sprinter 2020',
        brand: 'Mercedes-Benz',
        status: 'active',
    },
];
exports.initialUsers = [
    {
        email: 'admin@delyaqui.com',
        name: 'Admin',
        lastName: 'Principal',
        role: 'admin',
        avatar: 'https://example.com/avatar.png',
        password: '@admin.123',
    },
];
exports.initialPermissions = [
    {
        id: 'perm-view',
        name: 'View Data',
        code: 'VIEW_DATA',
        description: 'Permission to view all data',
    },
];
exports.initialRoles = [
    {
        id: 'role-admin',
        name: 'Admin',
        description: 'Administrator role',
        isDefault: true,
        permissions: ['perm-view'],
    },
];
exports.initialSubsidiaries = [
    {
        id: 'sub-001',
        name: 'Sucursal Centro',
        address: 'Calle 1, Colonia Centro',
        phone: '6441234567',
        active: true,
    },
];
exports.initialExpenseCategories = [
    {
        id: 'cat-001',
        name: 'Combustible',
        description: 'Gastos de gasolina y diesel',
    },
];
exports.initialExpenses = [
    {
        id: 'exp-001',
        subsidiaryId: 'sub-001',
        categoryId: 'cat-001',
        categoryName: 'Combustible',
        date: new Date(),
        amount: 500,
        description: 'Gasolina para la unidad 1',
        paymentMethod: 'efectivo',
        responsible: 'Pedro Gómez',
        notes: '',
        receiptUrl: '',
    },
];
exports.initialDrivers = [
    {
        id: 'drv-001',
        name: 'Carlos Méndez',
        licenseNumber: 'LIC1234567',
        phoneNumber: '6447654321',
        status: 'active',
    },
];
exports.initialRoutes = [
    {
        id: 'route-001',
        name: 'Ruta Norte',
        driver: 'drv-001',
        vehicle: 'VHL123',
        status: 'Pendiente',
        startTime: '2025-06-01T08:00:00Z',
        estimatedArrival: '2025-06-01T12:00:00Z',
    },
];
//# sourceMappingURL=seed-data.js.map
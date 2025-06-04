export const initialShipments = [
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
    consNumber: 123456,
  },
];

export const initialVehicles = [
  {
    plateNumber: 'VHL123',
    model: 'Sprinter 2020',
    brand: 'Mercedes-Benz',
    status: 'active',
  },
];

export const initialUsers = [
  {
    email: 'admin@delyaqui.com',
    name: 'Admin',
    lastName: 'Principal',
    role: 'admin',
    avatar: 'https://example.com/avatar.png',
    password: '@admin.123', // Hash generado previamente
  },
];

export const initialPermissions = [
  {
    id: 'perm-view',
    name: 'View Data',
    code: 'VIEW_DATA',
    description: 'Permission to view all data',
  },
];

export const initialRoles = [
  {
    id: 'role-admin',
    name: 'Admin',
    description: 'Administrator role',
    isDefault: true,
    permissions: ['perm-view'],
  },
];

export const initialSubsidiaries = [
  {
    id: 'sub-001',
    name: 'Sucursal Centro',
    address: 'Calle 1, Colonia Centro',
    phone: '6441234567',
    active: true,
  },
  {
    id: 'sub-002',
    name: 'Hermosillo',
    address: 'Calle 2, Colonia Centro',
    phone: '6441234567',
    officeManager: 'Juan Perez',
    fedexCostPackage: 59.51,
    dhlCostPackage: 45,
    active: true,
  },
  {
    id: 'sub-003',
    name: 'Nogales',
    address: 'Calle 3, Colonia Centro',
    phone: '6441234567',
    officeManager: 'John Doe',
    fedexCostPackage: 59.51,
    dhlCostPackage: 45,
    active: true,
  }
];

export const initialExpenseCategories = [
  {
    id: 'cat-001',
    name: 'Combustible',
    description: 'Gastos de gasolina y diesel',
  },
];

export const initialExpenses = [
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

export const initialDrivers = [
  {
    id: 'drv-001',
    name: 'Carlos Méndez',
    licenseNumber: 'LIC1234567',
    phoneNumber: '6447654321',
    status: 'active',
  },
];

export const initialRoutes = [
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
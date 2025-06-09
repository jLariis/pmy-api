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
    id: '963e7a1a-a1f2-44a8-a873-4d0f9580e5ec',
    name: 'Combustible',
    description: 'Gastos de gasolina y diesel',
  },
  {
    id: '438f571a-1987-4fc5-bddd-c13b0ee75703',
    name: 'Nómina',
    description: 'Gastos de nómina',
  },
  {
    id: 'e23ef20d-9731-42e6-a280-e524b5f041f4',
    name: 'Renta',
    description: 'Gastos de renta',
  },
  {
    id: '84e3c788-831c-4d17-98f7-ab0334d6a438',
    name: 'Recarga',
    description: 'Gastos de plan o recarga telefónica',
  },
  {
    id: '793ddf36-eb89-456f-a78c-745f8c8986db',
    name: 'Peajes',
    description: 'Gastos de casetas en carretera',
  },
  {
    id: '2588fc6f-06c3-4674-9b59-fb772d6f713a',
    name: 'Servicios',
    description: 'Gastos de servicios como agua, luz, internet',
  },
  {
    id: '3fdbdd8d-74bd-474d-bed9-488f8d20f4f4',
    name: 'Mantenimiento',
    description: 'Gastos de mantimiento de unidades',
  },
  {
    id: 'c32df4db-d462-453d-89f0-59c5b2e8603b',
    name: 'Impuestos',
    description: 'Gastos de pago de impuestos',
  },
  {
    id: '3f3663b5-da2b-4487-b921-236fc6d79f79',
    name: 'Seguros',
    description: 'Gastos de pago de seguros',
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
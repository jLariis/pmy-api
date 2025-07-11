export const initialUsers = [
  {
    email: 'admin@delyaqui.com',
    name: 'Admin',
    lastName: 'Principal',
    role: 'admin',
    avatar: 'https://example.com/avatar.png',
    password: '@admin.123', // Contraseña en texto plano, se hasheará
    active: true,
    createdAt: new Date(), // Fecha en UTC
    subsidiaryId: null, // Opcional: asigna un ID de Subsidiary si es necesario
  },
];
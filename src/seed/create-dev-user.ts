/**
 * Script puntual (solo desarrollo): crea/actualiza una cuenta superadmin para
 * pruebas. Mismo patrón que seed.ts (DataSource de config + bcrypt rounds 10).
 *
 *   npm run create:dev-user
 *
 * Email y contraseña se leen de env para no dejarlos en el repo:
 *   DEV_USER_EMAIL / DEV_USER_PASSWORD
 */
import 'dotenv/config';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { config } from '../config/config';

(async () => {
  const email = process.env.DEV_USER_EMAIL;
  const password = process.env.DEV_USER_PASSWORD;
  if (!email || !password) {
    console.error('❌ Falta DEV_USER_EMAIL o DEV_USER_PASSWORD en el entorno.');
    process.exit(1);
  }

  const db = config().database;
  const dataSource = new DataSource({ ...db, port: db.port || 3306 });

  try {
    await dataSource.initialize();
    console.log('✅ Conexión establecida');

    const userRepo = dataSource.getRepository('user');
    const roleRepo = dataSource.getRepository('role');

    // superadmin = privilegio máximo (el guard lo deja pasar siempre).
    const superRole = await roleRepo.findOne({ where: { key: 'superadmin' } });
    if (!superRole) {
      console.warn("⚠️  No existe el rol 'superadmin' en la tabla role; se asigna solo el string de rol.");
    }

    const hashed = await bcrypt.hash(password, 10);
    const existing = await userRepo.findOne({ where: { email } });

    if (existing) {
      await userRepo.save({
        ...existing,
        password: hashed,
        role: 'superadmin',
        roleId: superRole?.id ?? existing.roleId,
        active: true,
      });
      console.log(`♻️  Usuario actualizado: ${email} (rol: superadmin)`);
    } else {
      await userRepo.save({
        email,
        password: hashed,
        name: 'Dev',
        lastName: 'Admin',
        role: 'superadmin',
        roleId: superRole?.id,
        active: true,
      });
      console.log(`🆕 Usuario creado: ${email} (rol: superadmin)`);
    }

    await dataSource.destroy();
    console.log('✅ Listo');
  } catch (err) {
    console.error('❌ Error creando el usuario dev:', err);
    process.exit(1);
  }
})();

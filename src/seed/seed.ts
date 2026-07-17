import 'dotenv/config';
import { DataSource } from 'typeorm';
import { config } from '../config/config';
import { runSeeds } from './seed-utils';

(async () => {
  const dbConfig = config().database;

  // Usar el mismo glob de entidades de config().database (igual que data-source.ts
  // de las migraciones). Antes se sobreescribía con el barrel `../entities`, que
  // no re-exporta todas las entidades → faltaba metadata (p.ej. Devolution.returningHistory).
  const dataSource = new DataSource({
    ...dbConfig,
  });

  try {
    await dataSource.initialize();
    console.log('✅ Conexión establecida');
    await runSeeds(dataSource);
    await dataSource.destroy();
    console.log('✅ Seeds ejecutados con éxito');
  } catch (err) {
    console.error('❌ Error ejecutando seeds:', err);
    process.exit(1);
  }
})();

import 'dotenv/config';
import { DataSource } from 'typeorm';
import { config } from '../config/config';
import { runSeeds } from './seed-utils';
import * as entities from '../entities';

(async () => {
  const dbConfig = config().database;

  const dataSource = new DataSource({
    ...dbConfig,
    entities: Object.values(entities),
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

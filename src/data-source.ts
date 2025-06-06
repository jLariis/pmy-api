import 'dotenv/config';
import { DataSource } from 'typeorm';
import { config } from './config/config'; // <- tu archivo ya existente

const dbConfig = config().database;

export const AppDataSource = new DataSource({
  ...dbConfig,
  migrations: ['src/database/migrations/*.ts'], // ruta a tus migraciones
});
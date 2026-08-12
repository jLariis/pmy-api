import { DataSourceOptions } from 'typeorm';

export const config = () => {
    return {
        port: Number(process.env.PORT),
        jwtSecret: process.env.JWT_SECRET,
        database: {
        type: 'mysql',
        host: process.env.DB_HOST,
        port: +process.env.DB_PORT,
        username: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        // Regla del proyecto: el esquema SIEMPRE se cambia por migraciones, NUNCA por synchronize.
        // Se fuerza en false a propósito (se ignora DB_SYNC) para que nadie lo reactive por error.
        synchronize: false,
        logging: JSON.parse(process.env.DB_LOGGING),
        timezone: "Z",
        entities: [__dirname + '/../entities/*.entity.{js,ts}'],
        migrations: [__dirname + '/../database/migrations/*.{js,ts}'],
        } satisfies DataSourceOptions,
    };
};
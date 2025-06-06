import { readFileSync } from 'fs';
import { DataSourceOptions } from 'typeorm';
import * as path from 'path';

export const config = () => {
    const isProd = process.env.NODE_ENV === 'prod';

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
        synchronize: JSON.parse(process.env.DB_SYNC),
        logging: JSON.parse(process.env.DB_LOGGING),
        entities: [__dirname + '/../entities/*.entity.{js,ts}'],
        ssl: {
            ca: readFileSync(path.join(__dirname, '../ssl', 'ca.pem')).toString(),
            rejectUnauthorized: true,
        },
        } satisfies DataSourceOptions,
    };
};
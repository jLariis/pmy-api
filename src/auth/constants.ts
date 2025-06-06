import * as dotenv from 'dotenv';
dotenv.config();

export const jwtConstants = {
    secret: process.env.JWT_SECRET,
    expiration: process.env.JWT_EXPIRATION
};
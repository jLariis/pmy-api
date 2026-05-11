import { HttpStatus } from '@nestjs/common';

export type ErrorDomain = 'exercise-api' | 'generic';

export class BusinessException extends Error {
    public readonly id: string;
    public readonly timestamp: Date;
    public readonly metadata?: any; // 👈 NUEVA PROPIEDAD

    constructor(
        public readonly domain: ErrorDomain,
        public readonly message: string,
        public readonly apiMessage: string,
        public readonly status: HttpStatus,
        metadata?: any // 👈 NUEVO PARÁMETRO OPCIONAL
    ) {
        super(message);
        this.id = BusinessException.genId();
        this.timestamp = new Date();
        this.metadata = metadata; // 👈 ASIGNACIÓN
    }

    private static genId(length = 16): string {
        const p = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        return [...Array(length)].reduce(
            (a) => a + p[~~(Math.random() * p.length)],
            '',
        );
    }
}
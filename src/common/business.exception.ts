import { HttpStatus } from '@nestjs/common';

export type ErrorDomain = 'exercise-api' | 'generic';

export class BusinessException extends Error {
    public readonly id: string;
    public readonly timestamp: Date;

    constructor(
        public readonly domain: ErrorDomain,
        // TODO: message should receive array of strings
        public readonly message: string,
        // TODO: apiMessage should receive array of strings
        public readonly apiMessage: string,
        public readonly status: HttpStatus,
    ) {
        super(message);
        this.id = BusinessException.genId();
        this.timestamp = new Date();
    }

    private static genId(length = 16): string {
        const p = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        return [...Array(length)].reduce(
            (a) => a + p[~~(Math.random() * p.length)],
            '',
        );
    }
}
import { HttpStatus } from '@nestjs/common';
export type ErrorDomain = 'exercise-api' | 'generic';
export declare class BusinessException extends Error {
    readonly domain: ErrorDomain;
    readonly message: string;
    readonly apiMessage: string;
    readonly status: HttpStatus;
    readonly id: string;
    readonly timestamp: Date;
    constructor(domain: ErrorDomain, message: string, apiMessage: string, status: HttpStatus);
    private static genId;
}

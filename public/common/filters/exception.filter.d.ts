import { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { ErrorDomain } from '../business.exception';
export interface ApiError {
    id: string;
    domain: ErrorDomain;
    message: string;
    timestamp: Date;
}
export declare class CustomExceptionFilter implements ExceptionFilter {
    private readonly logger;
    catch(exception: Error, host: ArgumentsHost): void;
}

import { Driver } from './driver.entity';
export declare class Route {
    id: string;
    name: string;
    driver: Driver;
    vehicle: string;
    status: 'En progreso' | 'Completada' | 'Pendiente' | 'Cancelada';
    startTime: string;
    estimatedArrival: string;
}

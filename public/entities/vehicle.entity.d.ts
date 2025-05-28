import { Route } from './route.entity';
import { VehicleStatus } from '../common/enums/vehicle-status.enum';
export declare class Vehicle {
    id: string;
    plateNumber: string;
    model: string;
    brand: string;
    status: VehicleStatus;
    routes: Route[];
}

import { Role } from './role.entity';
export declare class Permission {
    id: string;
    name: string;
    description?: string;
    code: string;
    roles: Role[];
}

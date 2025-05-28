import { Permission } from './permission.entity';
import { User } from './user.entity';
export declare class Role {
    id: string;
    name: string;
    description?: string;
    isDefault: boolean;
    permissions: Permission[];
    users: User[];
}

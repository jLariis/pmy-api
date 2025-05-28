import { Role } from './role.entity';
import { Subsidiary } from './subsidiary.entity';
export declare class User {
    id: string;
    email: string;
    password: string;
    name?: string;
    lastName?: string;
    role: 'admin' | 'user';
    subsidiary?: Subsidiary;
    roles: Role[];
    permissions?: string[];
    avatar?: string;
}

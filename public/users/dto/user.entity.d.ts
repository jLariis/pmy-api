import { Role } from "src/common/enums/role.enum";
export declare class User {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    role: Role;
    apartmentNumber: number;
    resetToken: string;
}

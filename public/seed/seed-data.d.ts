export declare const initialShipments: {
    trackingNumber: string;
    recipientName: string;
    recipientAddress: string;
    recipientCity: string;
    recipientZip: string;
    commitDate: string;
    commitTime: string;
    recipientPhone: string;
    priority: string;
    status: string;
    payment: {
        amount: number;
        status: string;
    };
    statusHistory: {
        status: string;
        timestamp: string;
        notes: string;
    }[];
}[];
export declare const initialVehicles: {
    plateNumber: string;
    model: string;
    brand: string;
    status: string;
}[];
export declare const initialUsers: {
    email: string;
    name: string;
    lastName: string;
    role: string;
    avatar: string;
    password: string;
}[];
export declare const initialPermissions: {
    id: string;
    name: string;
    code: string;
    description: string;
}[];
export declare const initialRoles: {
    id: string;
    name: string;
    description: string;
    isDefault: boolean;
    permissions: string[];
}[];
export declare const initialSubsidiaries: {
    id: string;
    name: string;
    address: string;
    phone: string;
    active: boolean;
}[];
export declare const initialExpenseCategories: {
    id: string;
    name: string;
    description: string;
}[];
export declare const initialExpenses: {
    id: string;
    subsidiaryId: string;
    categoryId: string;
    categoryName: string;
    date: Date;
    amount: number;
    description: string;
    paymentMethod: string;
    responsible: string;
    notes: string;
    receiptUrl: string;
}[];
export declare const initialDrivers: {
    id: string;
    name: string;
    licenseNumber: string;
    phoneNumber: string;
    status: string;
}[];
export declare const initialRoutes: {
    id: string;
    name: string;
    driver: string;
    vehicle: string;
    status: string;
    startTime: string;
    estimatedArrival: string;
}[];

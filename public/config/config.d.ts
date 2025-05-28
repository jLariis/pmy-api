export declare const config: () => {
    port: number;
    jwtSecret: string;
    database: {
        type: "mysql";
        host: string;
        port: number;
        username: string;
        password: string;
        database: string;
        synchronize: any;
        logging: any;
        entities: string[];
    };
};

export declare class EmailService {
    private transporter;
    constructor();
    sendPasswordResetEmail(to: string, token: string): Promise<void>;
}

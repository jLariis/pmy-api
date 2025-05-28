"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BusinessException = void 0;
class BusinessException extends Error {
    constructor(domain, message, apiMessage, status) {
        super(message);
        this.domain = domain;
        this.message = message;
        this.apiMessage = apiMessage;
        this.status = status;
        this.id = BusinessException.genId();
        this.timestamp = new Date();
    }
    static genId(length = 16) {
        const p = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        return [...Array(length)].reduce((a) => a + p[~~(Math.random() * p.length)], '');
    }
}
exports.BusinessException = BusinessException;
//# sourceMappingURL=business.exception.js.map
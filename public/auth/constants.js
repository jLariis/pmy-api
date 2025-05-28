"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.jwtConstants = void 0;
const dotenv = require("dotenv");
dotenv.config();
exports.jwtConstants = {
    secret: process.env.JWT_SECRET,
    expiration: process.env.JWT_EXPIRATION
};
//# sourceMappingURL=constants.js.map
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HasRole = exports.ROLES_KEY = void 0;
const common_1 = require("@nestjs/common");
exports.ROLES_KEY = 'role';
const HasRole = (role) => {
    return (0, common_1.SetMetadata)(exports.ROLES_KEY, role);
};
exports.HasRole = HasRole;
//# sourceMappingURL=roles.decorator.js.map
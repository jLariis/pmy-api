"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ShipmentsModule = void 0;
const common_1 = require("@nestjs/common");
const shipments_controller_1 = require("./shipments.controller");
const typeorm_1 = require("@nestjs/typeorm");
const shipment_entity_1 = require("../entities/shipment.entity");
const shipments_service_1 = require("./shipments.service");
let ShipmentsModule = class ShipmentsModule {
};
exports.ShipmentsModule = ShipmentsModule;
exports.ShipmentsModule = ShipmentsModule = __decorate([
    (0, common_1.Module)({
        controllers: [shipments_controller_1.ShipmentsController],
        imports: [typeorm_1.TypeOrmModule.forFeature([shipment_entity_1.Shipment])],
        providers: [shipments_service_1.ShipmentsService],
        exports: [shipments_service_1.ShipmentsService],
    })
], ShipmentsModule);
//# sourceMappingURL=shipments.module.js.map
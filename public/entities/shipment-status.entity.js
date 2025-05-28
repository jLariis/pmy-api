"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ShipmentStatus = void 0;
const typeorm_1 = require("typeorm");
const shipment_entity_1 = require("./shipment.entity");
const shipment_status_type_enum_1 = require("../common/enums/shipment-status-type.enum");
let ShipmentStatus = class ShipmentStatus {
};
exports.ShipmentStatus = ShipmentStatus;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], ShipmentStatus.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => shipment_entity_1.Shipment, shipment => shipment.statusHistory),
    __metadata("design:type", shipment_entity_1.Shipment)
], ShipmentStatus.prototype, "shipment", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'enum',
        enum: shipment_status_type_enum_1.ShipmentStatusType,
    }),
    __metadata("design:type", String)
], ShipmentStatus.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", String)
], ShipmentStatus.prototype, "timestamp", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true }),
    __metadata("design:type", String)
], ShipmentStatus.prototype, "notes", void 0);
exports.ShipmentStatus = ShipmentStatus = __decorate([
    (0, typeorm_1.Entity)('shipment_status')
], ShipmentStatus);
//# sourceMappingURL=shipment-status.entity.js.map
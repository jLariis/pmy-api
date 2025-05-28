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
exports.Shipment = void 0;
const typeorm_1 = require("typeorm");
const payment_entity_1 = require("./payment.entity");
const shipment_status_entity_1 = require("./shipment-status.entity");
const priority_enum_1 = require("../common/enums/priority.enum");
const shipment_status_type_enum_1 = require("../common/enums/shipment-status-type.enum");
let Shipment = class Shipment {
};
exports.Shipment = Shipment;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], Shipment.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", String)
], Shipment.prototype, "trackingNumber", void 0);
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", String)
], Shipment.prototype, "recipientName", void 0);
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", String)
], Shipment.prototype, "recipientAddress", void 0);
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", String)
], Shipment.prototype, "recipientCity", void 0);
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", String)
], Shipment.prototype, "recipientZip", void 0);
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", String)
], Shipment.prototype, "commitDate", void 0);
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", String)
], Shipment.prototype, "commitTime", void 0);
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", String)
], Shipment.prototype, "recipientPhone", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'enum',
        enum: shipment_status_type_enum_1.ShipmentStatusType,
        default: shipment_status_type_enum_1.ShipmentStatusType.PENDIENTE,
    }),
    __metadata("design:type", String)
], Shipment.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'enum',
        enum: priority_enum_1.Priority,
        default: priority_enum_1.Priority.BAJA,
    }),
    __metadata("design:type", String)
], Shipment.prototype, "priority", void 0);
__decorate([
    (0, typeorm_1.OneToOne)(() => payment_entity_1.Payment, { cascade: true }),
    (0, typeorm_1.JoinColumn)(),
    __metadata("design:type", payment_entity_1.Payment)
], Shipment.prototype, "payment", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => shipment_status_entity_1.ShipmentStatus, status => status.shipment, { cascade: true }),
    __metadata("design:type", Array)
], Shipment.prototype, "statusHistory", void 0);
exports.Shipment = Shipment = __decorate([
    (0, typeorm_1.Entity)('shipment')
], Shipment);
//# sourceMappingURL=shipment.entity.js.map
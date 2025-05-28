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
exports.RouteIncome = void 0;
const typeorm_1 = require("typeorm");
const subsidiary_entity_1 = require("./subsidiary.entity");
let RouteIncome = class RouteIncome {
};
exports.RouteIncome = RouteIncome;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], RouteIncome.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => subsidiary_entity_1.Subsidiary, subsidiary => subsidiary.incomes),
    __metadata("design:type", subsidiary_entity_1.Subsidiary)
], RouteIncome.prototype, "subsidiary", void 0);
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", Date)
], RouteIncome.prototype, "date", void 0);
__decorate([
    (0, typeorm_1.Column)('decimal'),
    __metadata("design:type", Number)
], RouteIncome.prototype, "ok", void 0);
__decorate([
    (0, typeorm_1.Column)('decimal'),
    __metadata("design:type", Number)
], RouteIncome.prototype, "ba", void 0);
__decorate([
    (0, typeorm_1.Column)('decimal'),
    __metadata("design:type", Number)
], RouteIncome.prototype, "collections", void 0);
__decorate([
    (0, typeorm_1.Column)('decimal'),
    __metadata("design:type", Number)
], RouteIncome.prototype, "total", void 0);
__decorate([
    (0, typeorm_1.Column)('decimal'),
    __metadata("design:type", Number)
], RouteIncome.prototype, "totalIncome", void 0);
exports.RouteIncome = RouteIncome = __decorate([
    (0, typeorm_1.Entity)('route_income')
], RouteIncome);
//# sourceMappingURL=route-income.entity.js.map
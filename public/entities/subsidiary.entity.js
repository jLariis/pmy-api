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
exports.Subsidiary = void 0;
const typeorm_1 = require("typeorm");
const route_income_entity_1 = require("./route-income.entity");
const expense_entity_1 = require("./expense.entity");
const user_entity_1 = require("./user.entity");
let Subsidiary = class Subsidiary {
};
exports.Subsidiary = Subsidiary;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], Subsidiary.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", String)
], Subsidiary.prototype, "name", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true }),
    __metadata("design:type", String)
], Subsidiary.prototype, "address", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true }),
    __metadata("design:type", String)
], Subsidiary.prototype, "phone", void 0);
__decorate([
    (0, typeorm_1.Column)({ default: true }),
    __metadata("design:type", Boolean)
], Subsidiary.prototype, "active", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => route_income_entity_1.RouteIncome, income => income.subsidiary),
    __metadata("design:type", Array)
], Subsidiary.prototype, "incomes", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => expense_entity_1.Expense, expense => expense.subsidiary),
    __metadata("design:type", Array)
], Subsidiary.prototype, "expenses", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => user_entity_1.User, user => user.subsidiary),
    __metadata("design:type", Array)
], Subsidiary.prototype, "users", void 0);
exports.Subsidiary = Subsidiary = __decorate([
    (0, typeorm_1.Entity)('subsidiary')
], Subsidiary);
//# sourceMappingURL=subsidiary.entity.js.map
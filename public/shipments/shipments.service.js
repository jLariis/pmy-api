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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ShipmentsService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const shipment_entity_1 = require("../entities/shipment.entity");
const shipment_status_type_enum_1 = require("../common/enums/shipment-status-type.enum");
const XLSX = require("xlsx");
let ShipmentsService = class ShipmentsService {
    constructor(shipmentRepository) {
        this.shipmentRepository = shipmentRepository;
    }
    async create() {
    }
    async processFile(file) {
        if (!file)
            throw new common_1.BadRequestException('No file uploaded');
        const { buffer, originalname } = file;
        if (!originalname.match(/\.(csv|xlsx?)$/i)) {
            throw new common_1.BadRequestException('Unsupported file type');
        }
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(sheet, {
            range: 6,
            header: 1,
        });
        const today = new Date();
        const todayISO = today.toISOString();
        const isCSV = originalname.toLowerCase().endsWith('.csv');
        const shipments = jsonData
            .map((row) => {
            if (!row || row.length === 0)
                return null;
            const commitDate = new Date(row[5]);
            const daysDiff = (commitDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
            let priority;
            if (daysDiff <= 0)
                priority = 'alta';
            else if (daysDiff <= 3)
                priority = 'media';
            else
                priority = 'baja';
            return {
                trackingNumber: row[0],
                recipientName: isCSV ? row[13] : row[1],
                recipientAddress: isCSV ? row[14] : row[2],
                recipientCity: isCSV ? row[15] : row[3],
                recipientZip: isCSV ? row[18] : row[4],
                commitDate: isCSV ? row[20] : row[5],
                commitTime: isCSV ? row[21] : row[6],
                recipientPhone: isCSV ? row[23] : row[7],
                status: shipment_status_type_enum_1.ShipmentStatusType.PENDIENTE,
                payment: null,
                priority,
                statusHistory: [
                    {
                        status: shipment_status_type_enum_1.ShipmentStatusType.RECOLECCION,
                        timestamp: todayISO,
                        notes: 'Paquete recogido en sucursal',
                    },
                ],
            };
        })
            .filter(Boolean);
        const result = await this.shipmentRepository.save(shipments);
        return { saved: result.length };
    }
    async findAll() {
        return await this.shipmentRepository.find({
            relations: ['statusHistory', 'payment']
        });
    }
    async findOne(id) {
        return await this.shipmentRepository.findOneBy({ id });
    }
    async update(id, updateUserDto) {
        return await this.shipmentRepository.update(id, updateUserDto);
    }
    remove(id) {
        return this.shipmentRepository.delete(id);
    }
};
exports.ShipmentsService = ShipmentsService;
exports.ShipmentsService = ShipmentsService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(shipment_entity_1.Shipment)),
    __metadata("design:paramtypes", [typeorm_2.Repository])
], ShipmentsService);
//# sourceMappingURL=shipments.service.js.map
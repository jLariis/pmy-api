import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Vehicle } from 'src/entities/vehicle.entity';
import { VehicleKmsService } from './vehicle-kms.service';

/** Módulo liviano: lo importan salidas a ruta / cierres sin arrastrar todo Mantenimiento. */
@Module({
  imports: [TypeOrmModule.forFeature([Vehicle])],
  providers: [VehicleKmsService],
  exports: [VehicleKmsService],
})
export class VehicleKmsModule {}

import { Module } from '@nestjs/common';
import { PackageDossierController } from './package-dossier.controller';
import { PackageDossierService } from './package-dossier.service';

@Module({
  controllers: [PackageDossierController],
  providers: [PackageDossierService],
})
export class PackageDossierModule {}

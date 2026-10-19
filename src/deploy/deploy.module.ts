import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppRelease } from '../entities/app-release.entity';
import { DeployRun } from '../entities/deploy-run.entity';
import { User } from '../entities/user.entity';
import { DeployController } from './deploy.controller';
import { ReleaseController } from './release.controller';
import { DeployService } from './deploy.service';
import { DeployAnalysisService } from './deploy-analysis.service';
import { ReleaseService } from './release.service';
import { DeployRunner } from './deploy.runner';
import { GitRunner } from './git.runner';

@Module({
  imports: [TypeOrmModule.forFeature([AppRelease, DeployRun, User])],
  controllers: [DeployController, ReleaseController],
  providers: [DeployService, DeployAnalysisService, ReleaseService, DeployRunner, GitRunner],
})
export class DeployModule {}

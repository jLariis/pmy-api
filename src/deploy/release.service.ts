import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppRelease } from '../entities/app-release.entity';
import { User } from '../entities/user.entity';
import { DeployAnalysisService } from './deploy-analysis.service';
import { filterAudience, filterUnseen, ReleaseNote } from './release.util';

const SUPER_ROLES = ['superadmin', 'superamin'];

/** Versión actual y aviso de novedades por usuario. */
@Injectable()
export class ReleaseService {
  constructor(
    private readonly analysis: DeployAnalysisService,
    @InjectRepository(AppRelease) private readonly releases: Repository<AppRelease>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async current() {
    return { version: await this.analysis.currentVersion() };
  }

  async unseen(userId: string, role: string): Promise<{ releases: { version: string; publishedAt: Date; notes: ReleaseNote[] }[] }> {
    const user = await this.users.findOne({ where: { id: userId }, select: ['id', 'lastSeenReleaseVersion'] });
    if (!user) return { releases: [] };
    const current = await this.analysis.currentVersion();
    if (!user.lastSeenReleaseVersion) {
      // Usuario nuevo: no se le muestran novedades viejas.
      await this.users.update(userId, { lastSeenReleaseVersion: current });
      return { releases: [] };
    }
    const isSuper = SUPER_ROLES.includes(String(role || '').toLowerCase());
    const all = await this.releases.find();
    return {
      releases: filterUnseen(all, user.lastSeenReleaseVersion).map((r) => ({
        version: r.version,
        publishedAt: r.publishedAt,
        notes: filterAudience(r.notes ?? [], isSuper),
      })),
    };
  }

  async markSeen(userId: string) {
    const version = await this.analysis.currentVersion();
    await this.users.update(userId, { lastSeenReleaseVersion: version });
    return { version };
  }
}

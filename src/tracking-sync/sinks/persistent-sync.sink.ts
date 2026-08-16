import { Injectable } from '@nestjs/common';
import { SyncContext } from '../tracking-sync.types';
import { ApplyOutcome } from '../compare.types';

export interface ApplyActor {
  userId?: string;
  userName?: string;
  role?: string;
}

/**
 * Sink de escritura (status-only). Stub — implementación real en Task 4.
 * La firma se declara ya para que TrackingCompareService.applyMany compile.
 */
@Injectable()
export class PersistentSyncSink {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async applyPlan(_ctx: SyncContext, _actor: ApplyActor): Promise<ApplyOutcome> {
    throw new Error('PersistentSyncSink no implementado todavía (Task 4)');
  }
}

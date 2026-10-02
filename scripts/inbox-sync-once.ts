/**
 * Llena la bandeja FedEx (BD local) leyendo el buzón en SOLO LECTURA, sin levantar la API.
 *   npx ts-node -r tsconfig-paths/register scripts/inbox-sync-once.ts [--days 7] [--rounds 40]
 * Repite vueltas hasta ponerse al día y luego liga lo ya subido.
 */
import 'dotenv/config';
import { AppDataSource } from '../src/data-source';
import { ImapReaderService } from '../src/inbox/imap-reader.service';
import { KnowledgeService } from '../src/inbox/knowledge.service';
import { InboxIngestService } from '../src/inbox/inbox-ingest.service';
import { InboxLinkService } from '../src/inbox/inbox-link.service';
import { InboxMessage } from '../src/entities/inbox-message.entity';
import { InboxAttachment } from '../src/entities/inbox-attachment.entity';
import { InboxDetection } from '../src/entities/inbox-detection.entity';
import { InboxConsolidation } from '../src/entities/inbox-consolidation.entity';
import { InboxSyncState } from '../src/entities/inbox-sync-state.entity';

const arg = (n: string, d: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};

async function main() {
  const days = arg('days', '7');
  const config = { get: (k: string) => (k === 'INBOX_BACKFILL_DAYS' ? days : process.env[k]) } as any;
  await AppDataSource.initialize();
  try {
    const r = (e: any) => AppDataSource.getRepository(e);
    const ingest = new InboxIngestService(
      config,
      new ImapReaderService(config),
      new KnowledgeService(AppDataSource, config),
      r(InboxMessage) as any,
      r(InboxAttachment) as any,
      r(InboxDetection) as any,
      r(InboxConsolidation) as any,
      r(InboxSyncState) as any,
    );
    for (let i = 0; i < Number(arg('rounds', '40')); i++) {
      const rep = await ingest.runSync(true);
      console.log(`vuelta ${i + 1}:`, rep);
      if (rep.skipped || rep.read === 0) break;
    }
    console.log('ligado:', await new InboxLinkService(r(InboxConsolidation) as any, AppDataSource).linkPending());
    const counts = await AppDataSource.query('SELECT status, COUNT(*) n FROM inbox_message GROUP BY status');
    console.table(counts);
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((e) => {
  console.error('❌', e?.message ?? e);
  process.exit(1);
});

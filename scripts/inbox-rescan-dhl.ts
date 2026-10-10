/**
 * Recupera en la Bandeja los correos de DHL reenviados que llegaron ANTES de aceptar DHL
 * (quedaron "ignorados: No viene de FedEx" y sin cuerpo ni adjuntos). Correr una vez tras
 * la migración 1786000000103:
 *
 *   npx ts-node -r tsconfig-paths/register scripts/inbox-rescan-dhl.ts
 *
 * Lee el buzón en solo lectura (INBOX_IMAP_*). Solo vuelve a evaluar los ignorados por
 * remitente; requiere INBOX_DHL_FORWARDED distinto de "false".
 */
import 'dotenv/config';
import { AppDataSource } from '../src/data-source';
import { ImapReaderService } from '../src/inbox/imap-reader.service';
import { KnowledgeService } from '../src/inbox/knowledge.service';
import { InboxIngestService } from '../src/inbox/inbox-ingest.service';
import { InboxMessage } from '../src/entities/inbox-message.entity';
import { InboxAttachment } from '../src/entities/inbox-attachment.entity';
import { InboxDetection } from '../src/entities/inbox-detection.entity';
import { InboxConsolidation } from '../src/entities/inbox-consolidation.entity';
import { InboxSyncState } from '../src/entities/inbox-sync-state.entity';

async function main() {
  const config = { get: (k: string) => process.env[k] } as any;
  await AppDataSource.initialize();
  try {
    const imap = new ImapReaderService(config);
    if (!imap.isConfigured()) throw new Error('Faltan INBOX_IMAP_HOST / INBOX_IMAP_USER / INBOX_IMAP_PASSWORD en .env');
    const ingest = new InboxIngestService(
      config,
      imap,
      new KnowledgeService(AppDataSource, config),
      AppDataSource.getRepository(InboxMessage),
      AppDataSource.getRepository(InboxAttachment),
      AppDataSource.getRepository(InboxDetection),
      AppDataSource.getRepository(InboxConsolidation),
      AppDataSource.getRepository(InboxSyncState),
    );
    const r = await ingest.rescanForwardedDhl();
    console.log(`Correos que mencionan dhl.com: ${r.found}`);
    console.log(`  Recuperados como DHL: ${r.saved}`);
    console.log(`  Siguen ignorados (no son de DHL): ${r.stillIgnored}`);
    console.log(`  Ya estaban bien / no aplica: ${r.skipped}`);
    if (r.errors) console.log(`  Con error: ${r.errors}`);
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});

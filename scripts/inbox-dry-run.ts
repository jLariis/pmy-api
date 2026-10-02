/**
 * Prueba en seco del detector de la bandeja FedEx. NO escribe correos en BD.
 *
 *   npx ts-node -r tsconfig-paths/register scripts/inbox-dry-run.ts [--days 30] [--limit 300]
 *   npx ts-node -r tsconfig-paths/register scripts/inbox-dry-run.ts --eml-dir ./correos   (archivos .eml locales)
 *   npx ts-node -r tsconfig-paths/register scripts/inbox-dry-run.ts --rebuild-coverage    (arma la cobertura CP desde el historial)
 *
 * Lee el buzón con INBOX_IMAP_* (solo lectura) y reporta cuántos correos FedEx
 * detectaría solos, cuántos irían a revisión y por qué.
 */
import 'dotenv/config';
import { promises as fs } from 'fs';
import { join } from 'path';
import { AppDataSource } from '../src/data-source';
import { ImapReaderService, RawMail } from '../src/inbox/imap-reader.service';
import { KnowledgeService } from '../src/inbox/knowledge.service';
import { ZipCoverageService } from '../src/inbox/zip-coverage.service';
import { SubsidiaryZipCoverage } from '../src/entities/subsidiary-zip-coverage.entity';
import { analyzeMail, isAllowedSender } from '../src/inbox/mail-analysis';
import { detect } from '../src/inbox/detector';

const arg = (name: string, def?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? 'true' : def;
};

async function main() {
  const config = { get: (k: string) => process.env[k] } as any;
  await AppDataSource.initialize();
  try {
    if (process.argv.includes('--rebuild-coverage')) {
      const cov = new ZipCoverageService(AppDataSource.getRepository(SubsidiaryZipCoverage), AppDataSource);
      console.log('Cobertura CP:', await cov.rebuildFromHistory());
      const top: any[] = await AppDataSource.query(
        `SELECT s.name, COUNT(*) AS cps, SUM(c.share >= 0.7) AS dominantes
         FROM subsidiary_zip_coverage c JOIN subsidiary s ON s.id = c.subsidiaryId GROUP BY s.name ORDER BY cps DESC`,
      );
      console.table(top);
      if (!arg('days') && !arg('eml-dir')) return;
    }

    let mails: RawMail[] = [];
    const emlDir = arg('eml-dir');
    if (emlDir) {
      const files = (await fs.readdir(emlDir)).filter((f) => f.toLowerCase().endsWith('.eml'));
      mails = await Promise.all(files.map(async (f, i) => ({ uid: i + 1, uidValidity: 'local', source: await fs.readFile(join(emlDir, f)), internalDate: null })));
    } else {
      const imap = new ImapReaderService(config);
      if (!imap.isConfigured()) throw new Error('Faltan INBOX_IMAP_HOST / INBOX_IMAP_USER / INBOX_IMAP_PASSWORD en .env');
      const r = await imap.fetchNew({
        mailbox: imap.mailbox(),
        uidValidity: null,
        lastUid: 0,
        backfillDays: Number(arg('days', '30')),
        maxPerRun: Number(arg('limit', '300')),
      });
      mails = r.mails;
    }

    const knowledge = new KnowledgeService(AppDataSource, config);
    const domains = (process.env.INBOX_ALLOWED_DOMAINS || 'fedex.com').split(',');
    const totals = { leidos: 0, noFedex: 0, seguros: 0, revision: 0, sinSucursal: 0 };
    const reasons: Record<string, number> = {};
    for (const m of mails) {
      totals.leidos++;
      const a = await analyzeMail(m.source, m.internalDate);
      if (!isAllowedSender(a.fromAddress, domains)) {
        totals.noFedex++;
        continue;
      }
      const consNumbers = [...new Set([...a.consolidations.map((c) => c.consNumber), ...a.attachments.map((x) => x.consNumber).filter((x): x is string => !!x)])];
      const k = await knowledge.load(consNumbers);
      const r = detect({
        subject: a.subject,
        top: a.textTop,
        fromAddress: a.fromAddress,
        ccAddresses: a.cc,
        attachments: a.attachments.map((x) => ({ filename: x.filename, kind: x.kind, zips: x.summary?.zips ?? {}, cities: x.summary?.cities ?? {} })),
        consNumbers,
        knowledge: k,
      });
      const name = k.subsidiaries.find((s) => s.id === r.subsidiaryId)?.name ?? '—';
      if (r.autoSafe) totals.seguros++;
      else if (r.subsidiaryId) totals.revision++;
      else totals.sinSucursal++;
      if (!r.autoSafe) {
        const key = r.reason.replace(/[A-ZÁÉÍÓÚÑ][\wáéíóúñ ]+?(?= y |,| pero| \(|$)/g, '…');
        reasons[key] = (reasons[key] ?? 0) + 1;
      }
      console.log(
        (process.argv.includes('--verbose')
          ? a.attachments
              .filter((x) => x.summary)
              .map((x) => `      · ${x.filename} [${x.kind}] filas=${x.summary!.rowCount} fedex=${x.summary!.looksFedex} cp=${JSON.stringify(Object.entries(x.summary!.zips).sort((p, q) => q[1] - p[1]).slice(0, 4))} ciudades=${JSON.stringify(Object.entries(x.summary!.cities).sort((p, q) => q[1] - p[1]).slice(0, 3))}${x.summary!.parseError ? ' ERROR ' + x.summary!.parseError : ''}`)
              .join('\n') + '\n'
          : '') +
        `${r.autoSafe ? '✅' : r.subsidiaryId ? '🟡' : '⚪'} ${(a.date ?? new Date()).toISOString().slice(0, 16)} | ${a.subject.slice(0, 55).padEnd(55)} | ${name.padEnd(18)} | ${a.attachments.map((x) => x.kind).join(',')} | ${a.consolidations.map((c) => c.consNumber).join(',')} | ${r.reason}`,
      );
    }
    console.log('\nResumen:', totals);
    console.log('Motivos de revisión:', reasons);
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((e) => {
  console.error('❌', e?.message ?? e);
  process.exit(1);
});

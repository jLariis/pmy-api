# Bandeja de correo FedEx — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline, elegido por el usuario). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Leer `sistemas@` por IMAP (solo lectura), detectar sucursal/tipo/consolidado/cobros de cada correo FedEx con explicación y aprendizaje, y mostrar bandeja + tablero recibido vs subido en app-pmy.

**Architecture:** Módulo `src/inbox/` en pmy-api. Núcleo puro y testeado (`mail-parse`, `extract`, `attachment-classify`, `detector`) sin BD; servicios Nest alrededor (lectura IMAP, ingesta, conocimiento/aprendizaje, cobertura CP, ligado) + crons. Front en app-pmy con shadcn.

**Tech Stack:** NestJS 10, TypeORM 0.3 (MySQL), imapflow, mailparser, sanitize-html, xlsx, Jest; Next.js + shadcn + Tailwind.

Spec: `docs/superpowers/specs/2026-10-01-bandeja-correo-fedex-design.md`.

## Global Constraints

- Esquema SOLO por migración (DB_SYNC=false). Siguiente número: `1786000000086`, `1786000000087`.
- IMAP solo lectura (`BODY.PEEK` / `fetchOne(..., {source:true})` con mailbox abierto `readOnly: true`); nunca mover/borrar/marcar.
- `INBOX_ENABLED=false` por defecto; credenciales solo en `.env`.
- Solo remitentes de dominios `INBOX_ALLOWED_DOMAINS` (default `fedex.com`, incluye subdominios).
- Permiso `correo.bandejaFedex` (grupo Operaciones, roles `['superadmin']`).
- UI: AppLayout+withAuth+OperationHeader, solo shadcn+Tailwind, DataTable, 1 renglón por elemento, textos en llano (español).
- Corregir todos los errores tsc/lint/tests en archivos tocados.
- `graphify update .` tras modificar código.

## File Structure (pmy-api)

```
src/inbox/
  inbox.types.ts                 tipos compartidos (DetectionInput, Signal, etc.)
  text-normalize.util.ts         normalize(), cutQuotedHistory(), stripBoilerplate()
  extract.util.ts                extractConsolidations(), extractCobros(), numbersInFilename()
  attachment-classify.util.ts    classifyByName(), summarizeSheet(), finalizeKinds()
  detector.ts                    detect(input): DetectionResult  (DETECTOR_VERSION)
  __fixtures__/emails.ts         los 5 correos reales
  *.spec.ts                      pruebas de cada util
  imap-reader.service.ts         ImapReaderService (imapflow)
  knowledge.service.ts           carga conocimiento + confirm() (aprendizaje)
  zip-coverage.service.ts        rebuildFromHistory(), addFromConfirmed()
  inbox-ingest.service.ts        runSync(), ingestRaw(), redetect()
  inbox-link.service.ts          linkPending()
  inbox.crons.ts                 ingest cada 2 min, link cada 5 min, cobertura 03:30
  inbox-query.service.ts         list/detail/board/status para el controlador
  inbox.controller.ts
  inbox.module.ts
src/entities/inbox-*.entity.ts, subsidiary-zip-coverage.entity.ts
src/database/migrations/1786000000086-CreateInbox.ts
src/database/migrations/1786000000087-SyncBandejaFedexPermission.ts
scripts/inbox-dry-run.ts
```

## Tasks

### Task 1: Normalización y corte de hilo (puro)
Files: `src/inbox/inbox.types.ts`, `src/inbox/text-normalize.util.ts`, `src/inbox/__fixtures__/emails.ts`, spec.
Produces: `normalize(s: string): string` (MAYÚS, sin acentos, puntuación→espacio, colapsa), `cutQuotedHistory(text: string): { top: string; hadHistory: boolean }` (corta en línea que empieza con `From:`/`De:`/`Enviado:`/`Sent:`/`-----Original`/`El … escribió:`/`On … wrote:`), `stripBoilerplate(text): string` (quita bloque `**IMPORTANTE**…tiempo.`, `Caution! …`, `Sensitive-External`).
Tests: PREALERTA Caborca fixture → `top` contiene `818861721255` y NO `818861721656`; `hadHistory=true`; Cabo fixture sin historial → `hadHistory=false`; `normalize('Peñasco, Cd. Obregón')==='PENASCO CD OBREGON'`.

### Task 2: Extracción de consolidados y cobros (puro)
Files: `src/inbox/extract.util.ts`, spec.
Produces:
- `extractConsolidations(top: string): AnnouncedCons[]` — `{consNumber, kind:'master'|'f2', announcedCount|null}`. Patrones (sobre texto normalizado): `MASTER (\d{10,15})\s*(\d+)\s*GUIAS`, `F2 (\d{10,15})\s*(\d+)\s*GUIAS`, `CARGA YAQUI (\d{10,15})\s*(\d+)\s*GUIAS` (master), `CONS (\d{10,15})` + `PAQUETES (\d+)` (master). Dedup por consNumber.
- `extractCobros(top: string): Cobro[]` — `{trackingNumber, date|null, concept, amount|null}`; filas `(\d{12})\s+(?:(\d{2}/\d{2}/\d{4})\s+)?((?:COD|FTC)-COLLECT CASH\s+([\d.]+)\s+MXP|PIP NO AHS)` sobre texto plano (tabla HTML → texto con espacios). `NO PRECENTAN COBRO` → [].
- `numbersInFilename(name): string[]` — corridas de 12–15 dígitos.
Tests: Cabo → master 305821242296/189 + f2 305821512729/15, 11 cobros, primero `383905050153` 2210; Sur → master 305821198046/87, 5 cobros incl. FTC 579.64 sin fecha; Caborca top → master 818861721255/123, 3 cobros; "NO PRECENTAN COBRO" → [].

### Task 3: Clasificación de adjuntos (puro)
Files: `src/inbox/attachment-classify.util.ts`, spec.
Produces:
- `classifyByName(filename): AttachmentKind | null` — `.pdf`→pdf; contiene `CCP`→ccp (pero `CCP AEREO`→master_aereo, `CCP VALOR`→high_value); `AEREO`→master_aereo; `VALOR`→high_value; `F2` o `31 5`→f2; `CARGA|PREALERTA|YAQUI|SALIDA`→master; si no null.
- `summarizeWorkbook(buf: Buffer, filename): SheetSummary` — `{rowCount, zips: Record<string,number>, cities: Record<string,number>, looksFedex: boolean, isDhl: boolean, parseError?}` usando xlsx + `getHeaderIndexMap` (zip ← `recipPostal`, city ← `recipCity`) e `isThreeSheetDhlWorkbook`. Límite 10 MB / 20 000 filas.
- `finalizeKinds(items: {name, byName, summary}[]): AttachmentKind[]` — null+looksFedex→master; isDhl→dhl; resto `other`; si hay algún master/master_aereo, cada `ccp`→`ccp_ignored`.
Tests: nombres reales de los 5 correos; finalizeKinds con CARGA+CCP → [master, ccp_ignored]; workbook sintético con columnas `Tracking Number, Recip Postal, Recip City` → zips contados.

### Task 4: Detector (puro)
Files: `src/inbox/detector.ts`, spec.
Consumes: tipos de Task 1–3. Input:
```ts
interface DetectionInput {
  subject: string; top: string; fromAddress: string; ccAddresses: string[];
  attachments: { filename: string; kind: AttachmentKind; zips: Record<string,number>; cities: Record<string,number> }[];
  consNumbers: string[];
  knowledge: Knowledge;
}
interface Knowledge {
  subsidiaries: { id: string; name: string; region: 'BCS'|'SON'|null }[];
  zipCoverage: { zip: string; subsidiaryId: string; share: number; status: 'sugerido'|'confirmado'|'excluido'; city: string|null }[];
  aliases: { signalType: 'termino'|'remitente'|'copia'|'estacion'; term: string; subsidiaryId: string; hits: number; misses: number }[];
  knownConsolidations: { consNumber: string; subsidiaryId: string }[];
}
```
Produces: `detect(input): DetectionResult` = `{subsidiaryId|null, confidence, autoSafe, signals: Signal[], runnerUp, reason, detectorVersion: 1}`, y `GENERIC_TERMS`.
Reglas: tal cual spec (pesos 1.0/0.9/0.6/0.8/0.5/0.7×c/0.4×p, umbral 85 % CP, autoSafe = ≥2 señales independientes con una fuerte + ninguna ≥0.5 en contra + confidence ≥0.85). Términos de sucursal = nombre normalizado, sin prefijo `BODEGA`, + alias `termino` + ciudades de cobertura; match por palabra completa, término más largo gana; tolerancia edición ≤1 para términos ≥6 letras. Región por firma: `LA PAZ|BAJA CALIFORNIA SUR|BCS` → BCS, `HMOA|HERMOSILLO|SONORA` → SON.
Tests (knowledge sintético con Cabo, La Paz, Comondú(Constitucion), Caborca, Hermosillo, Bodega Hermosillo): Caborca fixture + CP → Caborca autoSafe; "Salida Aerea." sin términos + CP Cabo + remitente Wendy 39/40 → Cabo autoSafe; asunto CABO + CP La Paz → revisión con reason; CP 50/50 Hermosillo/Bodega → revisión; consolidado conocido + CP coincide → autoSafe; remitente disperso no vota.

### Task 5: Entidades + migración 086 + permiso 087
Files: 6 entidades `src/entities/inbox-message.entity.ts`, `inbox-attachment.entity.ts`, `inbox-detection.entity.ts`, `inbox-consolidation.entity.ts`, `inbox-signal-alias.entity.ts`, `inbox-sync-state.entity.ts`, `subsidiary-zip-coverage.entity.ts`; export en `src/entities/index.ts`; migraciones; catálogo `permission-catalog.ts` (`{ code: 'correo.bandejaFedex', name: 'Correos FedEx', groupName: 'Operaciones', roles: ['superadmin'] }`).
Verify: `npx tsc --noEmit -p tsconfig.json` limpio en archivos nuevos.

### Task 6: Lector IMAP + ingesta
Files: `imap-reader.service.ts`, `inbox-ingest.service.ts`, `knowledge.service.ts` (solo `load()`), `inbox.module.ts`, `app.module.ts`, `.env.example`, `package.json` (imapflow, mailparser, sanitize-html).
Produces: `ImapReaderService.fetchSince(state): AsyncIterable<{uid, uidValidity, source: Buffer}>`; `InboxIngestService.runSync(): Promise<SyncReport>`, `ingestRaw(raw, uid, uidValidity)`, `redetect(ids?)`. Idempotente por messageId; error por correo → status error, attempts++.
Test: spec de `ingestRaw` con repos en memoria mockeados: correo de dominio ajeno → ignorado; repetido → no duplica.

### Task 7: Conocimiento/aprendizaje + cobertura CP + ligado + crons
Files: `knowledge.service.ts` (`confirm(messageId, subsidiaryId, userId, kinds?)`), `zip-coverage.service.ts`, `inbox-link.service.ts`, `inbox.crons.ts`.
Pure helpers testeados: `computeZipShares(rows: {zip, subsidiaryId, n, city}[])`, `aliasPrecision(hits, misses)`, `uploadMinutes(receivedAt, uploadedAt)`.

### Task 8: API
Files: `inbox-query.service.ts`, `inbox.controller.ts`. Endpoints del spec; filtro por `req.user.subsidiaryIds` salvo superadmin.

### Task 9: Script dry-run
`scripts/inbox-dry-run.ts`: lee buzón (solo lectura) N días, corre parse+extract+classify+detect con conocimiento de BD, imprime resumen sin escribir en BD.

### Task 10: Front app-pmy
Rama `feat/bandeja-correo-fedex` en app-pmy. Página `app/correos-fedex/page.tsx`, componentes `components/correos-fedex/*` (tabla, detalle Sheet, tablero), panel `components/configuracion/inbox-panel.tsx` (Servidor → Correo FedEx) y `zip-coverage-panel.tsx` (Sucursales → Cobertura), entrada de menú y permiso `correo.bandejaFedex` en `lib/access`.

### Task 11: Verificación final
`npx jest src/inbox`, `npx tsc --noEmit`, lint en archivos tocados, `npm run build` en app-pmy (sin `next dev` largo — máquina de 8 GB), `graphify update .`, commits.

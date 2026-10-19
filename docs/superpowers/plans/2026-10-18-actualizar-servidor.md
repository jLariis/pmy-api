# Actualizar servidor + versiones + novedades — Implementation Plan

> **For agentic workers:** Ejecución inline (memoria `trabajo-inline`): superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Botón "Actualizar" en Configuración → Servidor que despliega `pmy-api` desde `main` con consola en vivo, sube la versión del sistema y publica un aviso de novedades en llano que cada usuario ve una vez.

**Architecture:** La API lanza `deploy/pmy-deploy.sh` desprendido de pm2 (`setsid -f`), que escribe NDJSON a un archivo; la UI lee el archivo por offset (sobrevive al reinicio). Las notas viven como archivos JSON en `release-notes/pending/` de ambos repos; el servidor las lee con `git show origin/main:` (nunca escribe en git). Versión y "visto" en BD.

**Tech Stack:** NestJS + TypeORM (MySQL) + Jest; Next.js (export estático) + shadcn + Tailwind + Vitest; bash.

**Spec:** `docs/superpowers/specs/2026-10-18-actualizar-servidor-design.md`

## Global Constraints
- Versión `MAYOR.MENOR.PARCHE`; patch 2.0.0→2.0.1, minor →2.1.0, major →3.0.0; semilla **2.0.0**.
- Rama siempre `main`; `git merge --ff-only`; árbol sucio o no-ff = falla sin tocar nada.
- Esquema solo por migración (`DB_SYNC=false`); migración defensiva con guard a `information_schema` (patrón 108). Número: `1786000000111`.
- El servidor **nunca** escribe/empuja a git. Solo `fetch`, `log`, `show`, `merge --ff-only` (este último solo en pmy-api).
- Build de Nest en carpeta aparte (`deleteOutDir: true` borraría `dist` en línea); swap a `dist` justo antes de `pm2 restart`.
- Un solo despliegue a la vez (`flock` + check de `deploy_run.status='running'`).
- Endpoints `server/deploy/*` solo `SuperAdminGuard`; `system/release/*` cualquier autenticado.
- UI: solo shadcn (`@/components/ui/*`) + Tailwind, dentro de la página de configuración existente; textos en llano, español.
- Consola = mismos colores/estilo que `components/configuracion/server-backup-panel.tsx`.
- Usuarios no se enteran del despliegue: sin avisos; reintento silencioso de errores de conexión (sin respuesta / 502 / 503 / 504) antes del encolado offline.
- Lanzar el script solo si `DEPLOY_ENABLED=1` (en Windows/dev el botón responde con mensaje en llano).

## Review Focus
- Usuario nuevo (`lastSeenReleaseVersion` null) → se marca visto sin aviso (test en `filterUnseen`).
- Usuario con varias versiones sin ver → todas juntas, más reciente primero (test).
- Versión solo con `correccion` → no abre diálogo, solo marca vista (test en `hasVisibleNews`).
- Nota JSON mal formada en el repo → se ignora con aviso en la vista previa, no rompe el análisis (test en `parseReleaseNote`).
- Reintento silencioso NO reintenta 400/401/403/404/500 (test en `shouldSilentRetry`).

---

### Task 1: Ramas
- [ ] `pmy-api`: `git switch -c feat/actualizar-servidor main` (los cambios sin commit del usuario viajan sin tocarse; **nunca** se agregan al stage).
- [ ] `app-pmy`: `git switch -c feat/actualizar-servidor main` (ídem).

### Task 2: Utilidades puras de versión/notas (pmy-api)
**Files:** Create `src/deploy/release.util.ts`, `src/deploy/release.util.spec.ts`

**Produces:**
- `type Bump = 'patch'|'minor'|'major'`; `type NoteKind = 'nuevo'|'mejora'|'rapido'|'correccion'`
- `interface ReleaseNote { id; kind: NoteKind; title; summary; where?; route?; steps?: string[]; audience?: 'todos'|'superadmin'; source: 'api'|'web'; fromCommit?: boolean }`
- `bumpVersion(v: string, b: Bump): string`
- `compareVersions(a: string, b: string): number`
- `suggestBump(notes: ReleaseNote[]): Bump` — `minor` si hay `nuevo`/`mejora`, si no `patch`.
- `parseReleaseNote(raw: string, id: string, source): { note?: ReleaseNote; error?: string }`
- `parseCommitSubject(s: string): { type: string|null; scope: string|null; text: string; userVisible: boolean }` — visible: feat/fix/perf.
- `commitToDraftNote(sha, subject, source): ReleaseNote` — feat→nuevo, fix→correccion, perf→rapido; `fromCommit: true`; texto con primera letra mayúscula.
- `filterUnseen<T extends {version}>(releases: T[], lastSeen: string|null): T[]` — null → `[]`; resto: versiones > lastSeen, desc.
- `filterAudience(notes, isSuper): ReleaseNote[]`; `hasVisibleNews(notes): boolean` (alguna no-`correccion`).

- [ ] Tests: `bumpVersion('2.0.0','patch')==='2.0.1'`, `('2.0.1','minor')==='2.1.0'`, `('2.3.4','major')==='3.0.0'`; `compareVersions('2.10.0','2.9.0')>0`; `suggestBump` con solo `correccion` → `patch`, con un `nuevo` → `minor`; `parseReleaseNote('{bad', …)` → `error`; sin `title` → error; `parseCommitSubject('feat(tareas): horarios por sucursal')` → `{type:'feat',scope:'tareas',text:'horarios por sucursal',userVisible:true}`; `refactor(ld): …` → `userVisible:false`; `filterUnseen(rs,null)` → `[]`; `filterUnseen([2.0.0,2.0.1,2.1.0],'2.0.0')` → `[2.1.0,2.0.1]`; `hasVisibleNews([correccion])===false`.
- [ ] `npx jest src/deploy/release.util.spec.ts` → FAIL, implementar, → PASS. Commit.

### Task 3: Datos (pmy-api)
**Files:** Create `src/entities/app-release.entity.ts`, `src/entities/deploy-run.entity.ts`, `src/database/migrations/1786000000111-AppReleaseDeploy.ts`; Modify `src/entities/index.ts`, `src/entities/user.entity.ts`.

- `AppRelease` (`app_release`): `id uuid`, `version varchar(20) unique`, `bump varchar(10)`, `notes json null` (ReleaseNote[]), `publishedNoteIds json null` (string[]), `apiCommit varchar(40) null`, `webCommit varchar(40) null`, `publishedAt datetime`, `publishedById varchar(36) null`.
- `DeployRun` (`deploy_run`): `id uuid`, `status varchar(10)` (`running|success|failed`), `step varchar(40) null`, `targetVersion`, `bump`, `notes json`, `publishedNoteIds json`, `fromApiCommit`, `toApiCommit`, `webCommit` (null ok), `startedAt`, `finishedAt null`, `durationMs int null`, `startedById`, `error text null`, `logPath varchar(255)`.
- `User.lastSeenReleaseVersion varchar(20) null`.
- Migración: crear tablas si no existen, columna en `user` con guard, semilla `2.0.0` (`bump='major'`, notas `[]`, `apiCommit` null). `down` revierte.
- [ ] `npx tsc --noEmit -p tsconfig.json` sin errores nuevos. Commit.

### Task 4: Análisis git (pmy-api)
**Files:** Create `src/deploy/git.runner.ts`, `src/deploy/deploy-analysis.service.ts`

**Produces:**
- `GitRunner.git(cwd: string, args: string[]): Promise<string>` (execFile `git`, timeout 60 s, lanza en error).
- `DeployAnalysisService.preview(): Promise<DeployPreview>`
  `DeployPreview = { currentVersion; apiDir; webDir|null; api: RepoDiff; web: RepoDiff|null; notes: ReleaseNote[]; noteErrors: string[]; migrations: string[]; suggestedBump: Bump; nextVersions: Record<Bump,string>; canRun: boolean; cannotRunReason?: string }`
  `RepoDiff = { headCommit; targetCommit; commits: {sha; subject; author; date}[]; dirty: boolean; branch: string }`
- Lógica: `fetch origin main`; base = `app_release` más reciente `apiCommit`/`webCommit` (null → no listar commits, solo notas); `git log base..origin/main --format=%H%x1f%s%x1f%an%x1f%aI`; notas = `git ls-tree --name-only origin/main release-notes/pending/` + `git show origin/main:<path>` filtrando ids ya publicados (unión de `publishedNoteIds` de todos los releases); commits visibles que no agregaron nota (`git log --diff-filter=A --name-only` por commit, o set de ids) → `commitToDraftNote`; migraciones = `git diff --name-only --diff-filter=A HEAD origin/main -- src/database/migrations`.
- Env: `DEPLOY_API_DIR` (default `process.cwd()`), `DEPLOY_WEB_REPO_DIR` (opcional; sin él `web=null`).
- `canRun=false` con razón en llano si `DEPLOY_ENABLED!=='1'`, rama ≠ main, árbol sucio o hay run `running`.
- [ ] Probar local con `curl`/navegador (Task 6) contra este mismo repo. Commit con Task 6.

### Task 5: Script de despliegue + lanzador + bitácora (pmy-api)
**Files:** Create `deploy/pmy-deploy.sh`, `deploy/setup-deploy.sh`, `deploy/README-deploy.md`, `src/deploy/deploy.runner.ts`, `src/deploy/deploy-log.util.ts`, `src/deploy/deploy-log.util.spec.ts`

- `pmy-deploy.sh <runId> <logDir> <apiDir> <pm2Name> <healthUrl>`: `exec 9>$logDir/deploy.lock; flock -n 9 || error`. Emite NDJSON `{"type":"phase","step":N,"total":6,"key":"fetch","label":"Traer main"}`, `{"type":"log","stream":"stdout|stderr","line":...}`, `{"type":"heartbeat"}` cada 10 s, `{"type":"done","ok":true,"durationMs":...}` / `{"type":"error","step":"key","message":"en llano"}`; escribe `<runId>.status.json` `{status, step, finishedAt, toApiCommit}` al final. Pasos keys: `fetch, deps, migrate, build, restart, verify`. `deps` solo si `git diff --name-only HEAD@{1} HEAD -- package-lock.json` no vacío. Build: `npx nest build` con `outDir` temporal (`npx tsc -p tsconfig.build.json --outDir dist-next` + copiar assets `ssl`) → `mv dist dist-prev && mv dist-next dist` → `pm2 restart $pm2Name --update-env`. Verify: `curl -fsS $healthUrl` hasta 90 s.
- `DeployRunner.launch(runId, logPath): void` — `spawn('setsid', ['-f','bash',script,...], {detached:true, stdio:'ignore'}).unref()`.
- `readLogFrom(path, offset): Promise<{ events: object[]; nextOffset: number }>` — lee bytes desde offset, solo líneas completas, ignora líneas no-JSON como `{type:'log',line}`.
- [ ] Tests de `readLogFrom`: línea parcial al final no se consume (nextOffset antes de ella); offset > tamaño → `{events:[],nextOffset:offset}`. FAIL → implementar → PASS.
- [ ] `bash -n deploy/pmy-deploy.sh` OK. Commit.

### Task 6: Servicio, endpoints y módulo (pmy-api)
**Files:** Create `src/deploy/deploy.service.ts`, `src/deploy/deploy.controller.ts`, `src/deploy/release.controller.ts`, `src/deploy/release.service.ts`, `src/deploy/dto/start-deploy.dto.ts`, `src/deploy/deploy.module.ts`; Modify `src/app.module.ts`.

- `server/deploy` (SuperAdminGuard): `GET status` → `{ currentVersion, running: DeployRun|null }`; `POST preview` → `DeployPreview`; `POST run` body `StartDeployDto { bump: Bump; notes: ReleaseNote[]; publishedNoteIds: string[] }` → `{ runId }` (409 en llano si ya corre; 400 si `!canRun`); `GET runs` (últimos 20); `GET runs/:id/log?offset=` → `{ events, nextOffset, run }`.
- `DeployService` en `onApplicationBootstrap`: runs `running` → leer `status.json`; `success` → crear `AppRelease` (version, notas, ids, commits) y cerrar run; `failed` → cerrar con error; sin status y > 30 min → `failed` "Se interrumpió".
- `system/release` (autenticado): `GET current` → `{ version }`; `GET unseen` → `{ releases: {version, publishedAt, notes}[] }` (usa `filterUnseen` + `filterAudience`; si `lastSeen` null → guarda versión actual y devuelve `[]`); `POST seen` → guarda versión actual.
- `@NoAudit()` en `runs/:id/log`.
- [ ] `npx tsc --noEmit` limpio en archivos tocados; `npx jest src/deploy` PASS. Commit.

### Task 7: Pestaña Actualizar (app-pmy)
**Files:** Create `lib/services/server-deploy.ts`, `lib/types/deploy.ts`, `components/configuracion/server-deploy-panel.tsx`, `components/configuracion/deploy-note-dialog.tsx`, `components/configuracion/deploy-console.tsx`; Modify `app/configuracion/page.tsx` (TabsTrigger `actualizar` solo `isSuper`).
- Tipos espejo de `DeployPreview`, `ReleaseNote`, `DeployRun`, eventos.
- Panel según maqueta: 3 métricas; 3 tarjetas de tipo (resaltada la elegida; sugerida con texto "sugerido"); lista de notas (Badge por tipo, editar → `DeployNoteDialog`, quitar; `fromCommit` en ámbar "Sin nota"); botón "Ver como usuario" abre `WhatsNewDialog` (Task 8) con las notas; "Actualizar a X" + "Revisar sin desplegar"; progreso + chips de pasos + `DeployConsole`; historial (tabla compacta, clic → consola del run).
- Polling: cada 1.5 s `GET runs/:id/log?offset`; errores de red durante el reinicio se ignoran y se sigue intentando hasta 3 min.
- `DeployConsole`: extraer el bloque de consola (colores de `server-backup-panel.tsx`) a este componente reutilizable.
- [ ] `npx tsc --noEmit` sin errores nuevos en archivos tocados. Commit.

### Task 8: Aviso de novedades + versión + reintento (app-pmy)
**Files:** Create `lib/services/release.ts`, `lib/release-news.ts`, `lib/release-news.test.ts`, `components/release-notes/whats-new-dialog.tsx`, `components/release-notes/whats-new-gate.tsx`, `lib/silent-retry.ts`, `lib/silent-retry.test.ts`; Modify `components/app-layout.tsx` (montar `WhatsNewGate` y etiqueta `vX.Y.Z`), `lib/axios-config.ts`.
- `lib/release-news.ts`: `groupNews(releases) → { highlights: ReleaseNote[]; fixesCount: number; version: string }`; `hasVisibleNews` espejo.
- `WhatsNewDialog({ releases, open, onClose })` según maqueta (izquierda lista, derecha detalle + pasos, "Ir a verlo" con `router.push(route)`, "Siguiente"/"Entendido").
- `WhatsNewGate`: al montar con usuario autenticado → `GET unseen`; si `hasVisibleNews` abre; al cerrar → `POST seen`; si no hay noticias visibles pero hay releases → `POST seen` silencioso.
- `shouldSilentRetry(error, attempt): boolean` — true si sin respuesta o status 502/503/504, `attempt < 15`, y no multipart; espera 2 s entre intentos (≈30 s). Interceptor de respuesta: antes del encolado offline, reintentar con `cfg.__silentAttempt`.
- [ ] Tests Vitest: `shouldSilentRetry({response:{status:500}},0)===false`; `({},0)===true`; `({response:{status:503}},15)===false`; `groupNews` cuenta `correccion` en `fixesCount`. `npx vitest run lib/release-news.test.ts lib/silent-retry.test.ts` PASS. Commit.

### Task 9: Notas de esta misma función
- [ ] `app-pmy/release-notes/pending/2026-10-18-novedades-al-entrar.json` (kind `nuevo`, audiencia todos: "Ahora verás aquí lo nuevo de cada actualización").
- [ ] `pmy-api/release-notes/pending/2026-10-18-actualizar-desde-configuracion.json` (kind `nuevo`, `audience: superadmin`).
- [ ] Commit en cada repo.

### Task 10: Verificación
- [ ] `npx jest src/deploy` y `npx vitest run` de los tests nuevos PASS.
- [ ] Backend local + app-pmy dev; abrir Configuración → Servidor → Actualizar; "Revisar sin desplegar" lista commits/notas del repo local; "Ver como usuario" abre el aviso. Captura al usuario.
- [ ] `graphify update .` en pmy-api.

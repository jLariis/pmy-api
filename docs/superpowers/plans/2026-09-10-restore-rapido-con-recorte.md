# Restore rápido con recorte de historial (Spec A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recortar el historial de `shipment_status` a los últimos 7 días en el respaldo prod → local (conservando todos los shipments/cargas) para bajar el restore de ~40 min a ~2 min, con opción de respaldo completo.

**Architecture:** El lado de producción genera un dump recortado con **dos pasadas de `mysqldump`** concatenadas al mismo gzip: pasada 1 = todo excepto `shipment_status`; pasada 2 = solo `shipment_status` con `--where` de N días. El resto de la cadena (descarga, apply rápido, consola en vivo, peso real, caché) queda intacto. Un toggle en el panel elige recortado (default) o completo.

**Tech Stack:** NestJS, `child_process.spawn`, `zlib` (backend `pmy-api`), Jest. Next.js + React + shadcn/ui + Tailwind (`app-pmy`).

## Global Constraints

- **Dos repos:** `C:\PMY\pmy-api` y `C:\PMY\app-pmy`, ambos en rama `feat/respaldo-restore-recorte` (ya creada).
- **Seguridad intacta:** no tocar candados (`BACKUP_ALLOW_RESTORE=1`, no-prod, `BACKUP_SECRET`) ni autenticación. Password de BD solo por `MYSQL_PWD`, nunca en args logueados.
- **Conservar todos los shipments/cargas:** solo se recortan filas de tablas de historial; los padres se conservan completos (sin huérfanos de FK).
- **Solo se recorta `shipment_status`** por ahora, vía la constante `HISTORY_TABLES` (extensible).
- **Default recorte = 7 días.** Toggle apagado ⇒ respaldo completo (`trimDays = 0`).
- **UI:** solo shadcn (`@/components/ui/*`) + Tailwind, en el panel existente.
- **Test backend:** `cd C:/PMY/pmy-api && npx jest backup`.

---

### Task 1: Helper `buildDumpArgs` + refactor de `streamDump`

**Files:**
- Modify: `C:/PMY/pmy-api/src/server-stats/backup.service.ts`
- Test: `C:/PMY/pmy-api/src/server-stats/backup.service.spec.ts`

**Interfaces:**
- Produces:
  - `static buildDumpArgs(db: DbTarget, opts: { routines: boolean; ignoreTables?: string[]; onlyTable?: string; whereClause?: string }): string[]`

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final de `backup.service.spec.ts`:

```ts
describe('BackupService.buildDumpArgs', () => {
  const db = { host: 'h', port: 3306, username: 'u', password: 'p', database: 'pmy-db' } as any;

  it('pasada 1: ignora tablas de historial, incluye rutinas, sin --where', () => {
    const args = BackupService.buildDumpArgs(db, { routines: true, ignoreTables: ['shipment_status'] });
    expect(args).toContain('--single-transaction');
    expect(args).toContain('--no-autocommit');
    expect(args).toContain('--routines');
    expect(args).toContain('--ignore-table=pmy-db.shipment_status');
    expect(args.some((a) => a.startsWith('--where'))).toBe(false);
    expect(args[args.length - 1]).toBe('pmy-db'); // la BD va al final (sin onlyTable)
  });

  it('pasada 2: solo la tabla, con --where y sin rutinas', () => {
    const args = BackupService.buildDumpArgs(db, {
      routines: false,
      onlyTable: 'shipment_status',
      whereClause: 'createdAt >= NOW() - INTERVAL 7 DAY',
    });
    expect(args).toContain('--where=createdAt >= NOW() - INTERVAL 7 DAY');
    expect(args).toContain('--skip-triggers');
    expect(args).not.toContain('--routines');
    expect(args[args.length - 2]).toBe('pmy-db');       // BD
    expect(args[args.length - 1]).toBe('shipment_status'); // tabla posicional
  });
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd C:/PMY/pmy-api && npx jest backup.service`
Expected: FAIL — `buildDumpArgs` no existe.

- [ ] **Step 3: Implementar el helper**

En `backup.service.ts`, junto a los otros métodos estáticos:

```ts
/** Arma los argumentos de una pasada de `mysqldump`. */
static buildDumpArgs(
  db: DbTarget,
  opts: { routines: boolean; ignoreTables?: string[]; onlyTable?: string; whereClause?: string },
): string[] {
  const args = [
    `--host=${db.host}`,
    `--port=${db.port}`,
    `--user=${db.username}`,
    '--single-transaction',
    '--no-autocommit',
    '--quick',
    '--no-tablespaces',
    '--default-character-set=utf8mb4',
  ];
  if (opts.routines) args.push('--routines', '--triggers', '--events');
  else args.push('--skip-triggers'); // triggers vienen ON por default; rutinas/events OFF
  for (const t of opts.ignoreTables ?? []) args.push(`--ignore-table=${db.database}.${t}`);
  if (opts.whereClause) args.push(`--where=${opts.whereClause}`);
  args.push(db.database);
  if (opts.onlyTable) args.push(opts.onlyTable);
  return args;
}
```

- [ ] **Step 4: Refactorizar `streamDump` para usar el helper (DRY)**

Reemplazar el arreglo `args` literal dentro de `streamDump` por:

```ts
const args = BackupService.buildDumpArgs(db, { routines: true });
```

(borrar las líneas del arreglo manual `[ '--host=…', …, db.database ]`).

- [ ] **Step 5: Correr y verificar que pasan**

Run: `cd C:/PMY/pmy-api && npx jest backup.service`
Expected: PASS (incluidos los tests previos).

- [ ] **Step 6: Commit**

```bash
cd C:/PMY/pmy-api && git add src/server-stats/backup.service.ts src/server-stats/backup.service.spec.ts && git commit -m "feat(respaldo): helper buildDumpArgs y refactor de streamDump (DRY)"
```

---

### Task 2: `streamTrimmedDump` + endpoint `/dump?trimDays=`

**Files:**
- Modify: `C:/PMY/pmy-api/src/server-stats/backup.service.ts`
- Modify: `C:/PMY/pmy-api/src/server-stats/backup.controller.ts`

**Interfaces:**
- Consumes: `buildDumpArgs` (Task 1), `dbTarget()`, `mysqldumpBin()`.
- Produces: `streamTrimmedDump(res: Response, days: number): void`; constante `HISTORY_TABLES`.

- [ ] **Step 1: Definir `HISTORY_TABLES`**

Cerca de `PHASE_WEIGHTS`, arriba de la clase, agregar:

```ts
/** Tablas de historial que se recortan en el respaldo recortado (por ahora solo una). */
const HISTORY_TABLES: { table: string; dateColumn: string }[] = [
  { table: 'shipment_status', dateColumn: 'createdAt' },
];
```

- [ ] **Step 2: Implementar `streamTrimmedDump`**

En `backup.service.ts`, después de `streamDump`:

```ts
/**
 * Dump recortado: 2+ pasadas de mysqldump al mismo gzip. Pasada 1 trae todo
 * excepto las tablas de historial; cada pasada siguiente trae una tabla de
 * historial solo con las filas de los últimos `days` días. Conserva todos los
 * padres → sin huérfanos de FK.
 */
streamTrimmedDump(res: Response, days: number): void {
  const db = this.dbTarget();
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', `attachment; filename="${db.database}-trim${days}d-${stamp}.sql.gz"`);
  res.setHeader('Cache-Control', 'no-store');

  const gzip = createGzip();
  gzip.on('error', (err) => res.destroy(err));
  gzip.pipe(res);

  const ignore = HISTORY_TABLES.map((h) => h.table);

  const runPass = (args: string[], isLast: boolean) =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(this.mysqldumpBin(), args, { env: { ...process.env, MYSQL_PWD: db.password } });
      let stderr = '';
      child.stderr.on('data', (d) => (stderr += d.toString()));
      child.on('error', (err) => reject(err));
      child.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`mysqldump exit ${code}: ${stderr.slice(0, 300)}`)),
      );
      child.stdout.pipe(gzip, { end: isLast });
    });

  (async () => {
    // Pasada 1: todo menos las tablas de historial.
    await runPass(BackupService.buildDumpArgs(db, { routines: true, ignoreTables: ignore }), false);
    // Pasadas 2..N: cada tabla de historial recortada.
    for (let i = 0; i < HISTORY_TABLES.length; i++) {
      const h = HISTORY_TABLES[i];
      const isLast = i === HISTORY_TABLES.length - 1;
      await runPass(
        BackupService.buildDumpArgs(db, {
          routines: false,
          onlyTable: h.table,
          whereClause: `${h.dateColumn} >= NOW() - INTERVAL ${days} DAY`,
        }),
        isLast,
      );
    }
  })().catch((err) => {
    this.logger.error(`Dump recortado falló: ${err?.message}`);
    if (!res.headersSent) res.status(500).json({ message: `mysqldump: ${err?.message}` });
    else res.destroy(err);
  });
}
```

- [ ] **Step 3: Endpoint acepta `trimDays`**

En `backup.controller.ts`, cambiar `dump`:

```ts
dump(@Res() res: Response, @Query('trimDays') trimDays?: string) {
  const n = Number(trimDays);
  if (n > 0) this.backupService.streamTrimmedDump(res, n);
  else this.backupService.streamDump(res);
}
```

(El `import { … Query … }` ya está en el controller de un cambio previo.)

- [ ] **Step 4: Compilar y correr tests**

Run: `cd C:/PMY/pmy-api && npx tsc --noEmit -p tsconfig.json && npx jest backup.service`
Expected: sin errores; tests PASS.

- [ ] **Step 5: Commit**

```bash
cd C:/PMY/pmy-api && git add src/server-stats/backup.service.ts src/server-stats/backup.controller.ts && git commit -m "feat(respaldo): streamTrimmedDump (2 pasadas) y /dump?trimDays="
```

---

### Task 3: `restore-from-prod` propaga el recorte

**Files:**
- Modify: `C:/PMY/pmy-api/src/server-stats/backup.service.ts` (`restoreFromProd`)
- Modify: `C:/PMY/pmy-api/src/server-stats/backup.controller.ts`

**Interfaces:**
- Produces: `restoreFromProd(res: Response, reuse = false, trimDays = 0): Promise<void>`.

- [ ] **Step 1: Firma y URL del dump**

En `restoreFromProd`, cambiar la firma:

```ts
async restoreFromProd(res: Response, reuse = false, trimDays = 0): Promise<void> {
```

En la construcción de la URL del dump (dentro del bloque `if (!usedCache)`), agregar el
query de recorte y un log:

```ts
step('connect', 'Conectando al API de producción…');
if (trimDays > 0) logLevel('phase', `Respaldo recortado a ${trimDays} días de historial (shipments completos).`);
const trimQs = trimDays > 0 ? `?trimDays=${trimDays}` : '';
const url = `${this.prodApiUrl().replace(/\/$/, '')}/server/backup/dump${trimQs}`;
const resp = await fetch(url, { headers: { 'X-Backup-Secret': secret } });
```

(Reemplaza la línea `const url = …/server/backup/dump\`;` actual y su `fetch`.)

- [ ] **Step 2: Controller reenvía `trim`**

En `backup.controller.ts`, `restoreFromProd`:

```ts
restoreFromProd(@Res() res: Response, @Query('reuse') reuse?: string, @Query('trim') trim?: string) {
  return this.backupService.restoreFromProd(res, reuse === '1', Number(trim) || 0);
}
```

- [ ] **Step 3: Compilar y correr tests**

Run: `cd C:/PMY/pmy-api && npx tsc --noEmit -p tsconfig.json && npx jest backup.service`
Expected: sin errores; tests PASS.

- [ ] **Step 4: Commit**

```bash
cd C:/PMY/pmy-api && git add src/server-stats/backup.service.ts src/server-stats/backup.controller.ts && git commit -m "feat(respaldo): restore-from-prod propaga ?trim= al dump de prod"
```

---

### Task 4: Cliente frontend propaga `trimDays`

**Files:**
- Modify: `C:/PMY/app-pmy/lib/services/server-backup.ts`

**Interfaces:**
- Produces: `streamRestoreFromProd(onEvent, onEnd, signal, reuseCache?, trimDays?)`.

- [ ] **Step 1: Firma y URL**

Cambiar la firma y la construcción de URL:

```ts
export async function streamRestoreFromProd(
  onEvent: (event: BackupEvent) => void,
  onEnd: () => void,
  signal: AbortSignal,
  reuseCache = false,
  trimDays = 0,
): Promise<void> {
  const token = useAuthStore.getState().token;
  const base = `${process.env.NEXT_PUBLIC_API_URL}/server/backup/restore-from-prod`;
  const qs = new URLSearchParams();
  if (reuseCache) qs.set("reuse", "1");
  if (trimDays > 0) qs.set("trim", String(trimDays));
  const url = qs.toString() ? `${base}?${qs.toString()}` : base;
  // … resto igual …
```

(Reemplaza el bloque actual `const base = …; const url = reuseCache ? … : base;`.)

- [ ] **Step 2: Verificar tipos**

Run: `cd C:/PMY/app-pmy && npx tsc --noEmit 2>&1 | grep -i server-backup`
Expected: sin salida (0 errores en el archivo tocado).

- [ ] **Step 3: Commit**

```bash
cd C:/PMY/app-pmy && git add lib/services/server-backup.ts && git commit -m "feat(respaldo): cliente propaga trimDays (?trim=) al restore"
```

---

### Task 5: Toggle de recorte en el panel

**Files:**
- Modify: `C:/PMY/app-pmy/components/configuracion/server-backup-panel.tsx`

**Interfaces:**
- Consumes: `streamRestoreFromProd(…, reuseCache, trimDays)` (Task 4), `Switch` (ya importado).

- [ ] **Step 1: Estado del recorte (default 7)**

Junto a los otros `useState`, agregar:

```tsx
const [trimDays, setTrimDays] = useState(7) // 7 = recortado (rápido); 0 = completo
```

- [ ] **Step 2: Toggle + nota, arriba del toggle de caché**

Antes del `<label>` del Switch de caché, agregar:

```tsx
<label className="flex items-center gap-2 text-xs text-muted-foreground">
  <Switch checked={trimDays > 0} onCheckedChange={(v) => setTrimDays(v ? 7 : 0)} disabled={running} />
  Recorte de historial (7 días) — mucho más rápido
</label>
{trimDays > 0 && (
  <p className="text-[11px] text-muted-foreground -mt-1">
    El historial de estatus se recorta a los últimos 7 días; los shipments se conservan completos.
  </p>
)}
```

- [ ] **Step 3: Pasar `trimDays` al iniciar**

En `start`, cambiar la llamada:

```tsx
streamRestoreFromProd(onEvent, () => { setRunning(false); abortRef.current = null }, controller.signal, reuseCache, trimDays)
```

y agregar `trimDays` al arreglo de deps del `useCallback` de `start` (junto a `onEvent, reuseCache`).

- [ ] **Step 4: Verificar tipos**

Run: `cd C:/PMY/app-pmy && npx tsc --noEmit 2>&1 | grep -i server-backup`
Expected: sin salida (0 errores en el archivo tocado).

- [ ] **Step 5: Commit**

```bash
cd C:/PMY/app-pmy && git add components/configuracion/server-backup-panel.tsx && git commit -m "feat(respaldo): toggle de recorte de historial (7 días) en el panel"
```

---

### Task 6: Verificación manual end-to-end

**Files:** ninguno.

- [ ] **Step 1: Levantar API local** con `BACKUP_ALLOW_RESTORE=1` + `BACKUP_SECRET`.

- [ ] **Step 2: Restore recortado**

Configuración → Respaldo de producción → toggle **Recorte** encendido → Traer producción → local.
Confirmar: log "Respaldo recortado a 7 días…", `shipment_status` se aplica en segundos, tiempo total ~minutos.

- [ ] **Step 3: Integridad**

En MySQL local: `SELECT COUNT(*) FROM shipment;` debe empatar con prod; `SELECT COUNT(*) FROM shipment_status;` debe ser mucho menor (solo ~7 días) y `SELECT MIN(createdAt) FROM shipment_status;` dentro de la ventana.

- [ ] **Step 4: Respaldo completo**

Apagar el toggle de recorte → correr de nuevo → confirmar que trae el historial completo (lento, comportamiento previo intacto).

---

## Self-Review

**Spec coverage:**
- Dump recortado 2 pasadas (ignore-table + where) → Task 1 (args) + Task 2 (stream). ✔
- `HISTORY_TABLES` extensible, solo `shipment_status` → Task 2 Step 1. ✔
- `/dump?trimDays=` y `restore-from-prod ?trim=` → Task 2/3. ✔
- Toggle default-on + nota, respaldo completo al apagar → Task 5. ✔
- Cliente propaga trimDays → Task 4. ✔
- Tests de `buildDumpArgs` → Task 1. ✔
- Verificación (integridad shipments completos / historial recortado) → Task 6. ✔

**Placeholder scan:** sin TBD/TODO; todos los pasos con código real.

**Type consistency:** `buildDumpArgs(db, opts)` definido en Task 1 y usado en Task 2; `streamTrimmedDump(res, days)` definido en Task 2 y usado por el controller; `restoreFromProd(res, reuse, trimDays)` alineado service↔controller (Task 3); `streamRestoreFromProd(…, reuseCache, trimDays)` alineado service↔panel (Tasks 4–5); `HISTORY_TABLES` con `{table, dateColumn}` usado consistente.

**Nota:** el spec mencionaba `--skip-routines/--skip-events`; en la práctica rutinas y events vienen OFF por default en mysqldump, así que solo se fuerza `--skip-triggers` (que sí viene ON). El efecto es el mismo (no duplicar objetos de esquema en la pasada 2) y el test lo refleja.

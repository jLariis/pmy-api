# Respaldo prod → local: visibilidad + velocidad — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hacer que el restore de la BD de producción al MySQL local sea más rápido y que muestre en vivo, en la misma pantalla, qué está haciendo — para que nunca parezca colgado.

**Architecture:** Se conserva la cadena existente (`mysqldump | gzip` en prod → descarga a temp → `gunzip | mysql` en local → NDJSON al panel React). Se enriquecen las flags de dump/restore (velocidad), el stream de descompresión con un passthrough que detecta tablas + heartbeat + cronómetro (visibilidad), el protocolo NDJSON (campos nuevos retrocompatibles) y el panel de Configuración (consola en vivo). Sin binarios nuevos.

**Tech Stack:** NestJS (backend, `src/server-stats/backup.service.ts`), Node streams (`zlib`, `child_process`), Jest. Frontend Next.js + React + shadcn/ui + Tailwind (`app-pmy`).

## Global Constraints

- **Dos repos:** backend en `C:\PMY\pmy-api` (rama `feat/respaldo-prod-visibilidad`, ya creada), frontend en `C:\PMY\app-pmy` (crear rama `feat/respaldo-prod-visibilidad` antes de tocar).
- **Seguridad intacta:** no tocar el doble candado (`BACKUP_ALLOW_RESTORE=1`, no-prod, `BACKUP_SECRET`) ni la autenticación. La contraseña de BD sigue viajando solo por `MYSQL_PWD`, **nunca** en args ni en logs emitidos a la UI.
- **UI (regla de casa app-pmy):** SOLO shadcn (`@/components/ui/*`) + Tailwind, dentro del panel existente. Nada de HTML crudo ni páginas nuevas.
- **Protocolo NDJSON retrocompatible:** los campos nuevos son opcionales; `scripts/restore-from-prod.ps1` debe seguir funcionando (ignora lo que no conoce).
- **Migraciones:** ninguna (no hay cambios de esquema).
- **Test backend:** `cd C:/PMY/pmy-api && npm test -- backup.service`.

---

### Task 1: Helpers puros de parsing y tiempos (backend)

**Files:**
- Modify: `C:/PMY/pmy-api/src/server-stats/backup.service.ts`
- Test: `C:/PMY/pmy-api/src/server-stats/backup.service.spec.ts`

**Interfaces:**
- Consumes: `type Phase`, `const PHASE_ORDER: Phase[]` (ya existen en el archivo).
- Produces:
  - `static parseTableMarker(line: string): string | null` — nombre de tabla si la línea es un marcador de datos, si no `null`.
  - `static summarizeTimings(marks: Partial<Record<Phase, number>>, end: number): Partial<Record<Phase, number>>` — duración en ms por fase (marca de la fase → siguiente fase con marca, o `end`).

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final de `backup.service.spec.ts`:

```ts
describe('BackupService.parseTableMarker', () => {
  it('reconoce el marcador de datos de mysqldump', () => {
    expect(BackupService.parseTableMarker('-- Dumping data for table `shipment`')).toBe('shipment');
  });
  it('acepta nombres con guion bajo y dígitos', () => {
    expect(BackupService.parseTableMarker('-- Dumping data for table `package_dispatch_history`')).toBe('package_dispatch_history');
  });
  it('ignora otras líneas del dump', () => {
    expect(BackupService.parseTableMarker('INSERT INTO `shipment` VALUES (1),(2);')).toBeNull();
    expect(BackupService.parseTableMarker('-- Table structure for table `shipment`')).toBeNull();
    expect(BackupService.parseTableMarker('')).toBeNull();
  });
});

describe('BackupService.summarizeTimings', () => {
  it('calcula duración de cada fase hasta la siguiente marca', () => {
    const marks = { connect: 0, download: 100, prepare: 700, restore: 750 };
    expect(BackupService.summarizeTimings(marks, 2000)).toEqual({
      connect: 100, download: 600, prepare: 50, restore: 1250,
    });
  });
  it('omite fases sin marca', () => {
    const marks = { connect: 0, restore: 500 };
    expect(BackupService.summarizeTimings(marks, 900)).toEqual({ connect: 500, restore: 400 });
  });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd C:/PMY/pmy-api && npm test -- backup.service`
Expected: FAIL — `parseTableMarker`/`summarizeTimings` no existen.

- [ ] **Step 3: Implementar los helpers**

En `backup.service.ts`, dentro de la clase `BackupService` (junto a `computePercent`):

```ts
/** Nombre de tabla si la línea es el marcador `-- Dumping data for table \`X\``. */
static parseTableMarker(line: string): string | null {
  const m = /^-- Dumping data for table `(.+?)`/.exec(line);
  return m ? m[1] : null;
}

/** Duración (ms) por fase: de su marca a la siguiente fase con marca, o a `end`. */
static summarizeTimings(
  marks: Partial<Record<Phase, number>>,
  end: number,
): Partial<Record<Phase, number>> {
  const out: Partial<Record<Phase, number>> = {};
  for (let i = 0; i < PHASE_ORDER.length; i++) {
    const p = PHASE_ORDER[i];
    const start = marks[p];
    if (start == null) continue;
    let stop = end;
    for (let j = i + 1; j < PHASE_ORDER.length; j++) {
      const next = marks[PHASE_ORDER[j]];
      if (next != null) { stop = next; break; }
    }
    out[p] = Math.max(0, stop - start);
  }
  return out;
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `cd C:/PMY/pmy-api && npm test -- backup.service`
Expected: PASS (incluidos los tests previos de `computePercent`/`isRestoreAllowed`).

- [ ] **Step 5: Commit**

```bash
cd C:/PMY/pmy-api && git add src/server-stats/backup.service.ts src/server-stats/backup.service.spec.ts && git commit -m "feat(respaldo): helpers puros parseTableMarker y summarizeTimings"
```

---

### Task 2: Optimizaciones de velocidad (dump + restore)

**Files:**
- Modify: `C:/PMY/pmy-api/src/server-stats/backup.service.ts` (`streamDump`, `restoreFile`, `restoreFromProd`)

**Interfaces:**
- Consumes: `dbTarget()`, `mysqlBin()`, `runMysql()`, `log()` (existentes).
- Produces: método privado `withRelaxedInnodb<T>(db, log, fn): Promise<T>` que baja `innodb_flush_log_at_trx_commit` a 2 y lo restaura en `finally`.

- [ ] **Step 1: Dump por-tabla transaccional**

En `streamDump`, agregar `'--no-autocommit'` al arreglo `args` (después de `--single-transaction`). Esto agrupa los INSERT de cada tabla en una transacción.

- [ ] **Step 2: Restore sin binlog**

En `restoreFile`, agregar al arreglo `args` del cliente `mysql`:

```ts
'--init-command=SET sql_log_bin=0',
```

(justo antes de `db.database`). Desactiva el binlog para toda la conexión de carga.

- [ ] **Step 3: Helper para relajar innodb y restaurarlo**

Agregar en la clase:

```ts
/**
 * Baja innodb_flush_log_at_trx_commit a 2 durante `fn` y restaura el valor
 * original al terminar. Si falta el privilegio, avisa y corre `fn` sin el ajuste.
 */
private async withRelaxedInnodb<T>(
  db: DbTarget,
  log: (stream: 'stdout' | 'stderr', line: string) => void,
  fn: () => Promise<T>,
): Promise<T> {
  let previous: string | null = null;
  try {
    previous = await this.queryScalar(db, 'SELECT @@GLOBAL.innodb_flush_log_at_trx_commit');
    await this.runMysql(db, undefined, ['-e', 'SET GLOBAL innodb_flush_log_at_trx_commit=2'], log);
    log('stdout', 'innodb_flush_log_at_trx_commit=2 (temporal, se restaura al terminar)');
  } catch {
    previous = null;
    log('stderr', 'No se pudo relajar innodb_flush_log_at_trx_commit (sigue sin ese ajuste).');
  }
  try {
    return await fn();
  } finally {
    if (previous != null) {
      await this.runMysql(db, undefined, ['-e', `SET GLOBAL innodb_flush_log_at_trx_commit=${Number(previous) || 1}`], log)
        .catch(() => log('stderr', 'No se pudo restaurar innodb_flush_log_at_trx_commit.'));
    }
  }
}

/** Corre `mysql -N -e <sql>` y devuelve la primera celda como string, o null. */
private queryScalar(db: DbTarget, sql: string): Promise<string | null> {
  const args = [`--host=${db.host}`, `--port=${db.port}`, `--user=${db.username}`, '-N', '-e', sql];
  return new Promise((resolve, reject) => {
    const child = spawn(this.mysqlBin(), args, { env: { ...process.env, MYSQL_PWD: db.password } });
    let out = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(out.trim().split(/\s+/)[0] || null) : reject(new Error(`mysql exit ${code}`))));
  });
}
```

- [ ] **Step 4: Envolver el restore con el helper**

En `restoreFromProd`, en el bloque de la fase `restore`, envolver la llamada a `restoreFile`:

```ts
step('restore', 'Restaurando en MySQL local…');
await this.withRelaxedInnodb(db, log, () =>
  this.restoreFile(db, tmpFile, size, (bytes) => {
    progress('restore', size ? bytes / size : 0, { bytes, totalBytes: size });
  }, log),
);
progress('restore', 1);
```

- [ ] **Step 5: Verificar que compila y los tests siguen verdes**

Run: `cd C:/PMY/pmy-api && npx tsc --noEmit -p tsconfig.json && npm test -- backup.service`
Expected: sin errores de tipos; tests PASS.

- [ ] **Step 6: Commit**

```bash
cd C:/PMY/pmy-api && git add src/server-stats/backup.service.ts && git commit -m "perf(respaldo): dump por-tabla (--no-autocommit), restore sin binlog e innodb_flush relajado"
```

---

### Task 3: Visibilidad en vivo (tabla actual, heartbeat, cronómetro, barra honesta)

**Files:**
- Modify: `C:/PMY/pmy-api/src/server-stats/backup.service.ts` (`restoreFromProd`, `restoreFile`)

**Interfaces:**
- Consumes: `parseTableMarker`, `summarizeTimings` (Task 1); `emit`, `step`, `progress`, `log` (locales en `restoreFromProd`).
- Produces: eventos NDJSON enriquecidos (`log` con `level`/`elapsedMs`, `done` con `timings`); `restoreFile` acepta un callback `onTable(name, index)`.

- [ ] **Step 1: Extender el emisor de logs con nivel y elapsed**

Al inicio de `restoreFromProd`, tras crear `emit`, agregar un reloj y un `log` enriquecido:

```ts
const t0 = Date.now();
const marks: Partial<Record<Phase, number>> = {};
const logLevel = (
  level: 'info' | 'warn' | 'phase' | 'table' | 'heartbeat',
  line: string,
) => emit({ type: 'log', level, line, elapsedMs: Date.now() - t0 });
```

Cambiar `step` para que marque el tiempo de la fase y emita un `log` `phase`:

```ts
const step = (key: Phase, message: string) => {
  marks[key] = Date.now();
  logLevel('phase', message);
  emit({ type: 'step', key, message, percent: BackupService.computePercent(key, 0) });
};
```

Mapear el `log` de `mysql` existente a niveles: en la firma `log(stream, line)`, emitir `logLevel(stream === 'stderr' ? 'warn' : 'info', line)` en vez del `emit` plano. (Sustituye la definición actual de `const log = ...`.)

- [ ] **Step 2: `restoreFile` reporta tabla actual y bytes descomprimidos**

Cambiar la firma de `restoreFile` para aceptar `onTable`:

```ts
private restoreFile(
  db: DbTarget,
  file: string,
  totalGz: number,
  onBytes: (n: number) => void,
  log: (stream: 'stdout' | 'stderr', line: string) => void,
  onTable: (name: string, index: number) => void,
): Promise<void> {
```

Entre `gunzip` y `child.stdin`, insertar un `Transform` que cuenta bytes descomprimidos y escanea líneas por marcador de tabla, y exponer el conteo:

```ts
const gunzip = createGunzip();
let tableCount = 0;
let decompressed = 0;
let tail = '';
const scanner = new Transform({
  transform(chunk, _enc, cb) {
    decompressed += chunk.length;
    const text = tail + chunk.toString('utf8');
    const lines = text.split('\n');
    tail = lines.pop() ?? '';
    for (const l of lines) {
      const name = BackupService.parseTableMarker(l);
      if (name) onTable(name, ++tableCount);
    }
    cb(null, chunk);
  },
});
```

Importar `Transform` de `stream` arriba del archivo:

```ts
import { Transform } from 'stream';
```

Cambiar el pipe final a: `gz.pipe(gunzip).pipe(scanner).pipe(child.stdin);`
Exponer los bytes descomprimidos: mantener una referencia (p. ej. asignar `this.lastDecompressed` no — mejor) devolver el avance vía `onBytes` sobre `decompressed`. Reemplazar el `gz.on('data')` que hoy cuenta bytes del `.gz` por el conteo del `scanner`: llamar `onBytes(decompressed)` dentro del `transform` (después de sumar). Quitar el listener `gz.on('data', …)` de conteo (el de `onBytes` viejo).

- [ ] **Step 3: Barra honesta + tabla actual + heartbeat en `restoreFromProd`**

Reemplazar el bloque de la fase `restore` por:

```ts
step('restore', 'Restaurando en MySQL local…');
let currentTable = '(inicio)';
let lastDecompressed = 0;
const heartbeat = setInterval(() => {
  const mb = (lastDecompressed / 1_048_576).toFixed(0);
  const secs = Math.round((Date.now() - (marks.restore ?? t0)) / 1000);
  logLevel('heartbeat', `sigue trabajando · ${secs}s · ${mb} MB descomprimidos · tabla: \`${currentTable}\``);
}, 2000);
try {
  await this.withRelaxedInnodb(db, log, () =>
    this.restoreFile(
      db, tmpFile, size,
      (bytes) => {
        lastDecompressed = bytes;
        // Barra honesta: topa en 95% mientras mysql sigue aplicando.
        const frac = size ? Math.min(0.95, bytes / (size * 4)) : 0; // ~4x expansión gz→sql
        progress('restore', frac);
      },
      log,
      (name, index) => { currentTable = name; logLevel('table', `▶ [#${index}] Restaurando \`${name}\``); },
    ),
  );
} finally {
  clearInterval(heartbeat);
}
progress('restore', 1);
```

- [ ] **Step 4: Emitir `done` con timings**

Cambiar el `emit({ type: 'done', … })` por:

```ts
emit({
  type: 'done',
  message: `Respaldo de producción restaurado en "${db.database}".`,
  percent: 100,
  timings: BackupService.summarizeTimings(marks, Date.now()),
});
```

- [ ] **Step 5: Verificar compilación y tests**

Run: `cd C:/PMY/pmy-api && npx tsc --noEmit -p tsconfig.json && npm test -- backup.service`
Expected: sin errores de tipos; tests PASS.

- [ ] **Step 6: Commit**

```bash
cd C:/PMY/pmy-api && git add src/server-stats/backup.service.ts && git commit -m "feat(respaldo): tabla en vivo, heartbeat, cronómetro por fase y barra honesta"
```

---

### Task 4: Caché opcional del dump (apagado por defecto)

**Files:**
- Modify: `C:/PMY/pmy-api/src/server-stats/backup.controller.ts`
- Modify: `C:/PMY/pmy-api/src/server-stats/backup.service.ts` (`restoreFromProd`)

**Interfaces:**
- Consumes: `restoreFromProd(res)` (se le agrega param `reuse`).
- Produces: `restoreFromProd(res: Response, reuse = false)`.

- [ ] **Step 1: Pasar el flag desde el controller**

En `backup.controller.ts`, importar `Query` y aceptar la query:

```ts
import { Controller, Get, Post, Query, Res, UseGuards } from '@nestjs/common';
// …
restoreFromProd(@Res() res: Response, @Query('reuse') reuse?: string) {
  return this.backupService.restoreFromProd(res, reuse === '1');
}
```

- [ ] **Step 2: Lógica de caché en el servicio**

En `restoreFromProd`, cambiar la firma a `async restoreFromProd(res: Response, reuse = false): Promise<void>` y el temporal a un nombre estable cuando se cachea:

```ts
const cacheFile = path.join(os.tmpdir(), 'pmy-restore-cache.sql.gz');
const tmpFile = cacheFile; // nombre estable: permite reusar entre corridas
```

En la fase `connect`/`download`, antes de descargar, checar caché:

```ts
let usedCache = false;
if (reuse) {
  const st = await fsp.stat(cacheFile).catch(() => null);
  const ageMs = st ? Date.now() - st.mtimeMs : Infinity;
  if (st && ageMs < 2 * 60 * 60 * 1000) {
    usedCache = true;
    const mins = Math.round(ageMs / 60000);
    marks.connect = Date.now(); marks.download = Date.now();
    logLevel('phase', `Usando dump en caché (hace ${mins} min), se salta la descarga.`);
  }
}
if (!usedCache) {
  // … bloque actual de step('connect')/step('download')/downloadToFile …
}
const { size } = await fsp.stat(tmpFile);
```

- [ ] **Step 3: No borrar el archivo cuando es caché**

En el `finally`, borrar el temp **solo si no se reusó** (para poder reusarlo la próxima):

```ts
} finally {
  if (!reuse) await fsp.unlink(tmpFile).catch(() => undefined);
  if (!res.writableEnded) res.end();
}
```

- [ ] **Step 4: Verificar compilación y tests**

Run: `cd C:/PMY/pmy-api && npx tsc --noEmit -p tsconfig.json && npm test -- backup.service`
Expected: sin errores; tests PASS.

- [ ] **Step 5: Commit**

```bash
cd C:/PMY/pmy-api && git add src/server-stats/backup.controller.ts src/server-stats/backup.service.ts && git commit -m "feat(respaldo): toggle opcional de reutilizar dump en caché (<2h), apagado por defecto"
```

---

### Task 5: Tipos y servicio del frontend

**Files:**
- Modify: `C:/PMY/app-pmy/lib/services/server-backup.ts`

**Interfaces:**
- Produces: `BackupEvent` extendido; `streamRestoreFromProd(onEvent, onEnd, signal, reuseCache?)`.

- [ ] **Step 1: Crear rama del frontend**

```bash
cd C:/PMY/app-pmy && git checkout -b feat/respaldo-prod-visibilidad
```

- [ ] **Step 2: Extender los tipos del evento**

En `server-backup.ts`, reemplazar el union `BackupEvent`:

```ts
export type LogLevel = "info" | "warn" | "phase" | "table" | "heartbeat";

export type BackupEvent =
  | { type: "step"; key: BackupPhase; message: string; percent: number }
  | { type: "progress"; phase: BackupPhase; percent: number; bytes?: number; totalBytes?: number }
  | { type: "log"; stream?: "stdout" | "stderr"; level?: LogLevel; line: string; elapsedMs?: number }
  | { type: "done"; message: string; percent: number; timings?: Partial<Record<BackupPhase, number>> }
  | { type: "error"; message: string };
```

- [ ] **Step 3: Agregar `reuseCache` a la función de stream**

Cambiar la firma y la URL:

```ts
export async function streamRestoreFromProd(
  onEvent: (event: BackupEvent) => void,
  onEnd: () => void,
  signal: AbortSignal,
  reuseCache = false,
): Promise<void> {
  const token = useAuthStore.getState().token;
  const base = `${process.env.NEXT_PUBLIC_API_URL}/server/backup/restore-from-prod`;
  const url = reuseCache ? `${base}?reuse=1` : base;
  // … resto igual …
```

- [ ] **Step 4: Verificar tipos**

Run: `cd C:/PMY/app-pmy && npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
cd C:/PMY/app-pmy && git add lib/services/server-backup.ts && git commit -m "feat(respaldo): tipos de evento enriquecidos y toggle reuseCache en el cliente"
```

---

### Task 6: Consola en vivo en el panel de Configuración

**Files:**
- Modify: `C:/PMY/app-pmy/components/configuracion/server-backup-panel.tsx`

**Interfaces:**
- Consumes: `BackupEvent` (Task 5), `streamRestoreFromProd(…, reuseCache)`, `Switch` de `@/components/ui/switch`.

- [ ] **Step 1: Estado nuevo (reloj, tabla, timings, reuse)**

Agregar imports y estado en `ServerBackupPanel`:

```tsx
import { Switch } from "@/components/ui/switch"
// …
const [currentTable, setCurrentTable] = useState<string>("")
const [elapsed, setElapsed] = useState(0)          // segundos, corre en el front
const [timings, setTimings] = useState<Partial<Record<string, number>>>({})
const [reuseCache, setReuseCache] = useState(false)
```

Guardar `line` con `level` y `elapsedMs`:

```tsx
interface LogLine { level?: string; stream?: "stdout" | "stderr"; line: string; elapsedMs?: number }
```

- [ ] **Step 2: Reloj que corre en el front**

Agregar un efecto que incrementa `elapsed` cada segundo mientras `running`:

```tsx
useEffect(() => {
  if (!running) return
  const id = setInterval(() => setElapsed((s) => s + 1), 1000)
  return () => clearInterval(id)
}, [running])
```

En `start`, resetear: `setElapsed(0); setCurrentTable(""); setTimings({})`.

- [ ] **Step 3: Manejar los eventos nuevos**

En `onEvent`, ampliar el `switch`:

```tsx
case "log":
  if (ev.level === "table" && ev.line) setCurrentTable(ev.line.replace(/^▶.*Restaurando `?/, "").replace(/`$/, ""))
  setLogs((l) => [...l.slice(-499), { level: ev.level, stream: ev.stream, line: ev.line, elapsedMs: ev.elapsedMs }])
  break
case "done":
  setPercent(100)
  setTimings(ev.timings ?? {})
  setResult({ ok: true, message: ev.message })
  break
```

- [ ] **Step 4: Toggle de caché junto al botón**

Debajo del botón "Traer producción → local", agregar (deshabilitado mientras corre):

```tsx
<label className="flex items-center gap-2 text-xs text-muted-foreground">
  <Switch checked={reuseCache} onCheckedChange={setReuseCache} disabled={running} />
  Reutilizar dump reciente (salta la descarga si hay uno de &lt; 2 h)
</label>
```

Y pasar el flag: `streamRestoreFromProd(onEvent, () => {…}, controller.signal, reuseCache)`.

- [ ] **Step 5: Encabezado en vivo + consola con niveles**

Sobre la cajita de logs, mostrar fase + tabla + reloj:

```tsx
{running && (
  <div className="flex items-center justify-between text-xs text-muted-foreground">
    <span>{phase}{currentTable ? ` · tabla: ` : ""}<code>{currentTable}</code></span>
    <span className="tabular-nums">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</span>
  </div>
)}
```

En el render de `logs`, colorear por `level`:

```tsx
{logs.map((l, i) => {
  const color =
    l.level === "phase" ? "text-sky-300"
    : l.level === "table" ? "text-cyan-300"
    : l.level === "warn" || l.stream === "stderr" ? "text-amber-300"
    : l.level === "heartbeat" ? "text-zinc-500"
    : "text-zinc-300"
  return (
    <div key={i} className={cn("whitespace-pre-wrap break-all", color)}>{l.line}</div>
  )
})}
```

- [ ] **Step 6: Resumen de tiempos al terminar**

Debajo del `result`, cuando haya `timings`:

```tsx
{Object.keys(timings).length > 0 && (
  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
    {Object.entries(timings).map(([k, ms]) => (
      <span key={k}><span className="font-medium">{PHASE_LABEL[k] ?? k}:</span> {Math.floor((ms as number) / 60000)}:{String(Math.round(((ms as number) % 60000) / 1000)).padStart(2, "0")}</span>
    ))}
  </div>
)}
```

- [ ] **Step 7: Verificar tipos y lint**

Run: `cd C:/PMY/app-pmy && npx tsc --noEmit`
Expected: sin errores. (Si hay ESLint del repo: `npx eslint components/configuracion/server-backup-panel.tsx`.)

- [ ] **Step 8: Commit**

```bash
cd C:/PMY/app-pmy && git add components/configuracion/server-backup-panel.tsx && git commit -m "feat(respaldo): consola en vivo (tabla, reloj, niveles), resumen de tiempos y toggle de caché"
```

---

### Task 7: Verificación manual end-to-end

**Files:** ninguno (solo verificación).

- [ ] **Step 1: Levantar API local**

Con `BACKUP_ALLOW_RESTORE=1` y `BACKUP_SECRET` en el entorno. (El panel es solo-dev; la API no debe apuntar a prod.)

- [ ] **Step 2: Ejecutar el restore desde el panel**

Configuración → "Respaldo de producción" → "Traer producción → local".
Confirmar en la consola en vivo:
- Líneas `▶ [#N] Restaurando \`tabla\`` apareciendo en tiempo real.
- Heartbeat cada ~2s cuando no hay tabla nueva.
- Reloj corriendo aunque no lleguen eventos.
- La barra ya no se queda pegada en 100% al final (se topa en 95% hasta que cierra).

- [ ] **Step 3: Confirmar resumen de tiempos**

Al terminar, verificar el resumen "Descargando respaldo: m:ss · Restaurando en local: m:ss …". Ese resumen dice dónde se va el tiempo real (insumo para decidir si más adelante hace falta mydumper).

- [ ] **Step 4: Probar el toggle de caché**

Segunda corrida con "Reutilizar dump reciente" encendido → la consola debe decir "Usando dump en caché (hace X min)" y saltarse la descarga.

- [ ] **Step 5: Confirmar que el script sigue funcionando**

```bash
cd C:/PMY/app-pmy && npm run restore:prod
```
Debe correr igual (los campos NDJSON nuevos se ignoran).

---

## Self-Review

**Spec coverage:**
- Velocidad (dump `--no-autocommit`, restore `sql_log_bin=0`, innodb flush) → Task 2. ✔
- Detección de tabla + heartbeat + cronómetro + barra honesta + protocolo extendido → Task 3. ✔
- Caché opcional apagado por defecto → Task 4 (back) + Task 6 Step 4 (toggle UI). ✔
- Frontend consola en vivo + tipos → Tasks 5–6. ✔
- Helpers puros con tests → Task 1. ✔
- Verificación manual → Task 7. ✔
- `.ps1` retrocompatible → Task 7 Step 5. ✔

**Placeholder scan:** sin TBD/TODO; todos los pasos con código real.

**Type consistency:** `parseTableMarker`/`summarizeTimings` definidos en Task 1 y usados en Task 3; `BackupEvent` con `level`/`elapsedMs`/`timings` espejeado back (Task 3) ↔ front (Task 5); `restoreFromProd(res, reuse)` alineado controller↔service (Task 4); `reuseCache` alineado service↔panel (Tasks 5–6).

**Nota de ajuste fino:** el factor `~4x` de expansión gz→sql en Task 3 Step 3 es una estimación para topar la barra; no afecta corrección (la barra igual se topa en 95%). Si en la verificación se ve muy adelantada/atrasada, ajustar el divisor — no bloquea.

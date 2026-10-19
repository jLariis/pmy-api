# Actualizar el servidor + versiones + aviso de novedades (Configuración → Servidor → Actualizar)

- **Fecha:** 2026-10-18
- **Autor:** Javier Laris (con Claude)
- **Estado:** Diseño aprobado en conversación (maquetas validadas). Ajustes visuales se harán ya viéndolo.
- **Repos afectados:** `pmy-api` (backend + script de despliegue), `app-pmy` (UI: pestaña y aviso)
- **Fuera de alcance:** despertar el servidor a demanda (Wake-on-LAN) — se deja para después.

## 1. Para qué

Hoy actualizar producción es manual (entrar al servidor, `git pull`, migraciones, build, `pm2 restart`).
Se quiere que el **superadmin**, cuando él decida, lo haga desde **Configuración → Servidor → Actualizar**
viendo una **consola en vivo igual a la del respaldo prod→local**, y que cada actualización:

1. suba la **versión del sistema** (hoy 2.0.0) según el tamaño del cambio, y
2. publique un **aviso de novedades en lenguaje llano** que cada usuario ve **una sola vez** al entrar
   después de la actualización (qué cambió, dónde está, mini tutorial).

## 2. Decisiones tomadas por el usuario

- El despliegue automático es **solo del backend `pmy-api` en el servidor**. El frontend lo publica
  **Vercel por su cuenta** al hacer push; el servidor no compila ni publica `app-pmy`.
- Las **notas de novedades se leen de ambos repos** (`pmy-api` y `app-pmy`).
- Se despliega **solo cuando el superadmin lo ordena** (botón), nunca automático por push.
- Siempre desde la rama **`main`**.
- **Versión única del sistema** (no una por repo), formato `MAYOR.MENOR.PARCHE`:
  - **Menor** (correcciones/ajustes) → sube el último número: 2.0.0 → **2.0.1**
  - **Mayor** (algo nuevo para usar) → sube el de en medio: 2.0.1 → **2.1.0**
  - **Muy grande** (cambia casi todo) → sube el primero: 2.x → **3.0.0**
- El aviso **lo arma el sistema solo**, pero **sin IA en el servidor**: las notas en lenguaje llano las
  escribe Claude **en el mismo commit** del cambio (archivo de nota en el repo). Además, los mensajes de
  commit se enriquecen con mejores textos (cuerpo del commit explicando el cambio en llano).
- Antes de desplegar el superadmin ve la **vista previa** del aviso, puede **editar** cada nota, **quitar**
  notas y **cambiar el tipo de versión** sugerido.
- Commits sin nota aparecen en la vista previa como renglón simple (marcado "Sin nota") para redactarlo o quitarlo.
- Diseño visual aprobado = las dos maquetas mostradas en la conversación (pestaña Actualizar y aviso
  de novedades). Se construyen con shadcn + Tailwind (reglas de UI de app-pmy).

## 3. Notas de novedades (en los repos)

### 3.1 Formato
Un **archivo por nota** (evita choques de merge entre ramas):
`release-notes/pending/AAAA-MM-DD-<slug>.json` en el repo que tuvo el cambio.

```json
{
  "id": "2026-10-18-tareas-del-dia",
  "kind": "nuevo",              // nuevo | mejora | rapido | correccion
  "title": "Tareas del día",
  "summary": "Ahora cada sucursal ve qué le falta hacer hoy y recibe un aviso cuando algo se atrasa.",
  "where": "Ícono de tareas en la barra de arriba",
  "route": "/tareas",           // opcional: botón "Ir a verlo"
  "steps": ["Toca el ícono de tareas arriba a la derecha.", "Revisa lo pendiente de tu sucursal.", "Al terminar, se marca solo."],
  "audience": "todos"           // todos | superadmin (opcional; default todos)
}
```

- Texto **sin tecnicismos** (regla de lenguaje llano de app-pmy): prohibido "endpoint", "intake", etc.;
  sí códigos de dominio (DEX07, consolidado, F2).
- `steps` solo para `nuevo`/`mejora`; `correccion` puede no traer pasos.
- Los archivos **no se borran** al publicar: el servidor recuerda en BD qué `id` ya se publicaron
  (así el servidor **nunca escribe en git**). Limpieza de notas viejas = tarea manual ocasional.

### 3.2 Regla para Claude (memoria)
Todo commit con cambio **visible para el usuario** lleva su archivo de nota en la misma carpeta del
repo correspondiente, y el mensaje del commit lleva cuerpo explicando el cambio en llano.
Commits internos (refactor, docs, test, chore) no llevan nota.

## 4. Cómo se ve (UI app-pmy)

### 4.1 Pestaña "Actualizar" (solo superadmin)
Nueva pestaña en `app/configuracion/page.tsx` junto a Respaldo y Energía. Contenido (ver maqueta):

1. **Resumen:** versión actual · cambios nuevos en `main` (suma de ambos repos) · migraciones nuevas · estado (En línea / Actualizando).
2. **Tipo de cambio:** 3 opciones (Menor / Mayor / Muy grande) mostrando la versión resultante.
   **Sugerencia:** Mayor si hay alguna nota `nuevo`/`mejora`; Menor si solo hay correcciones/rápido o nada.
3. **Lo que verán los usuarios:** lista de notas pendientes (pastilla por tipo + título), cada una editable
   (diálogo con los campos de la nota) y quitable. Commits sin nota en amarillo con "Redactar · Quitar".
   Botón "Ver como usuario" abre el aviso tal cual lo verá la gente.
4. **Botones:** "Actualizar a X.Y.Z" (principal) y "Revisar sin desplegar" (refresca el análisis).
5. **Avance:** paso N de M + cronómetro, barra de progreso, chips de pasos (✓ hecho, girando, pendiente).
6. **Consola:** misma apariencia que `server-backup-panel.tsx` (fondo `zinc-950`, mono 11px, fases en
   `sky-300`, detalles en `cyan-300`, avisos/stderr en `amber-300`, latidos en `zinc-500`, autoscroll, máx. ~500 líneas en pantalla).
7. **Historial:** cada actualización con versión, fecha, quién, duración y resultado; al abrir una se ve su consola completa.
8. Si un paso falla: mensaje rojo en llano con el paso que falló; el resto no se ejecuta.

### 4.2 Aviso de novedades (todos los usuarios)
Diálogo (ver maqueta) que aparece **después del login / al cargar la app** si hay versiones publicadas
que el usuario no ha visto:

- Izquierda: versión y lista de novedades (`nuevo`/`mejora`/`rapido`); abajo "También corregimos N detalles" (las `correccion`).
- Derecha: la novedad seleccionada con pastilla, título, resumen, dónde está y pasos numerados.
- Botones "Ir a verlo" (si trae `route`) y "Siguiente"/"Entendido". Al cerrar se marca como visto.
- Si el usuario tiene **varias versiones sin ver**, se juntan en un solo aviso (más reciente arriba).
- **Usuario nuevo** (nunca ha visto ninguna): se marca la versión actual como vista sin mostrar aviso — *decisión de Claude*.
- Notas `audience: superadmin` solo las ven superadmins.
- Si una versión no trae ninguna nota visible (solo correcciones), no se abre el diálogo; solo se marca vista — *decisión de Claude*.
- Pie de la app o menú de usuario muestra la versión actual (ej. "v2.1.0") — *decisión de Claude*, sin abrir el aviso de nuevo salvo que el usuario haga clic.

## 5. Cómo funciona (pmy-api)

### 5.1 Principio
El despliegue reinicia el propio `pmy-api`, así que **no puede correr dentro del proceso de Node**.
La API solo **lanza** un script independiente (desprendido de pm2, sobrevive al restart), y luego
**lee su bitácora** desde archivo. La pantalla consulta la bitácora por **desplazamiento** (offset), así
se reconecta sola cuando la API vuelve tras el reinicio.

### 5.2 Script `deploy/pmy-deploy.sh` (corre como el usuario de pm2, sin sudo)
Lanzado con doble fork (`setsid -f` / `nohup`) para que el `treekill` de pm2 no lo mate. Escribe:
- `/var/lib/pmy-deploy/<runId>.log` — una línea JSON por evento (NDJSON: `phase`, `log`, `warn`, `heartbeat`, `done`, `error`), mismo formato de eventos que la consola del respaldo.
- `/var/lib/pmy-deploy/<runId>.status.json` — paso actual, inicio, fin, resultado.
- Candado (`flock`) para que **nunca corran dos actualizaciones a la vez**.

Pasos (los que no aplican se marcan "sin cambios" y se saltan):
1. **Traer main:** verificar árbol limpio y rama `main`; `git fetch origin main`; `git merge --ff-only origin/main`. Si no es fast-forward o hay cambios locales → falla sin tocar nada.
2. **Dependencias:** `npm ci` solo si cambió `package-lock.json`.
3. **Migraciones:** `npm run migration:run` (regla del repo: `DB_SYNC=false`, esquema solo por migración).
4. **Build:** se compila en una **carpeta aparte** (no en `dist`, porque `nest-cli.json` tiene
   `deleteOutDir: true` y borraría el código de la API en línea). La API actual no se entera.
5. **Reiniciar:** se cambia la carpeta compilada por `dist` (renombrado, casi instantáneo) e
   inmediatamente `pm2 restart <proceso>` (nombre configurable, default `pmy-api`).
6. **Verificar:** esperar a que la API responda (health/versión) hasta N segundos.

Al terminar con éxito la API (ya reiniciada) **registra la versión publicada** (ver 5.4).
Si falla antes del reinicio, la versión anterior sigue en línea y la versión **no** sube.
Nota: si falla después de migraciones (p. ej. build), las migraciones ya quedaron aplicadas; el código
anterior sigue corriendo. Se informa en llano en el mensaje de error.

Rutas y nombres por variables de entorno en `.env` (con defaults): `DEPLOY_API_DIR` (`/opt/pmy-api`),
`DEPLOY_WEB_REPO_DIR` (clon de `app-pmy` solo lectura), `DEPLOY_PM2_NAME` (`pmy-api`),
`DEPLOY_LOG_DIR` (`/var/lib/pmy-deploy`), `DEPLOY_HEALTH_URL`.
`deploy/setup-deploy.sh` + `deploy/README-deploy.md` preparan carpetas, el clon de `app-pmy` y validan acceso git (patrón de `setup-power-schedule.sh`).

### 5.3 Lectura de `app-pmy` en el servidor
Clon **solo lectura** de `app-pmy` en `DEPLOY_WEB_REPO_DIR`; únicamente `git fetch origin main`
para leer commits y notas (`git log`, `git show origin/main:release-notes/...`). Nunca se compila.

### 5.4 Análisis previo ("Revisar sin desplegar")
Para cada repo: `git fetch`, commits entre el último commit publicado (guardado en BD) y `origin/main`;
de ahí:
- notas pendientes = archivos `release-notes/pending/*.json` en `origin/main` cuyo `id` no está publicado;
- commits sin nota = commits `feat`/`fix`/`perf` (por prefijo convencional) que no agregaron ningún archivo de nota → renglón con el asunto limpio (sin prefijo ni scope);
- migraciones nuevas = archivos nuevos en `src/database/migrations` (solo pmy-api).
- versión sugerida según §4.1.

Primera vez (sin último commit en BD): solo se toman las notas pendientes; no se listan commits viejos.

### 5.5 Datos (migración nueva, número siguiente libre)
- `app_release`: `id`, `version` (único, `x.y.z`), `bump` (`patch|minor|major`), `notes` (json: notas finales editadas, incluidas las redactadas a partir de commits sin nota), `apiCommit`, `webCommit`, `publishedAt`, `publishedById`. Semilla: **2.0.0** sin notas.
- `app_release_note_published`: `noteId` único (ids de archivos ya publicados) — o columna json en `app_release`; a criterio del builder.
- `deploy_run`: `id`, `status` (`running|success|failed`), `step`, `targetVersion`, `bump`, `startedAt`, `finishedAt`, `startedById`, `error`, `logPath`, `fromApiCommit`, `toApiCommit`. Las notas editadas se guardan en el run al iniciar y pasan a `app_release` solo si termina bien.
- `user.lastSeenReleaseVersion` (`varchar` null).

### 5.6 Endpoints
Superadmin (`SuperAdminGuard`), en `server/deploy`:
- `GET status` — versión actual, run en curso (si hay), último análisis.
- `POST preview` — corre el análisis (§5.4).
- `POST run` — body: `bump`, `notes` editadas. Rechaza si ya hay uno corriendo. Lanza el script y devuelve `runId`.
- `GET runs` — historial; `GET runs/:id/log?offset=N` — líneas nuevas desde el offset + estado.

Cualquier usuario autenticado, en `system/release`:
- `GET current` — versión actual.
- `GET unseen` — versiones publicadas posteriores a `lastSeenReleaseVersion` con sus notas (filtradas por audiencia).
- `POST seen` — marca la versión actual como vista.

El cierre del run (registrar `app_release`) lo hace la API al arrancar: si encuentra un `deploy_run`
`running` cuyo `status.json` dice éxito, lo cierra y publica la versión. Así no depende de que la
pantalla siga abierta.

### 5.7 Los usuarios no se enteran (decisión del usuario)
El superadmin actualiza a menudo y **los usuarios no deben notar nada**: sin franjas, avisos ni
mensajes de "actualizando". El único corte es el arranque de la API tras `pm2 restart` (estimado
< 1 min; se mide en el primer despliegue y queda en el historial). Para que pase desapercibido:
- Build en carpeta aparte (§5.2 paso 4), así no hay corte durante la compilación.
- En app-pmy, las peticiones que fallen **por no poder conectar** (sin respuesta / 502 / 503) se
  **reintentan solas en silencio** unos segundos antes de mostrar cualquier error — *decisión de Claude*.
  Nunca se reintentan respuestas reales de error (400/401/403/404/500 con cuerpo) para no duplicar guardados.
- El aviso de novedades sigue saliendo **después** (al siguiente ingreso), como algo bueno, no como interrupción.

## 6. Qué cuenta como éxito
- El superadmin actualiza producción sin entrar al servidor, viendo cada paso en vivo, y la pantalla se
  reconecta sola tras el reinicio y muestra el resultado.
- La versión sube correctamente (2.0.0 → 2.0.1 / 2.1.0 / 3.0.0) y queda en el historial.
- Cada usuario ve el aviso una vez, en lenguaje llano, con sus pasos.

## 7. Lo que sería un fracaso (aunque "funcione")
- Que un despliegue fallido deje la API caída o a medias sin decir en qué paso falló.
- Que dos despliegues corran a la vez.
- Que el aviso hable en técnico o salga cada vez que el usuario entra.
- Que el servidor escriba o empuje a git.
- Que los usuarios vean errores o mensajes de "actualizando" mientras se despliega.

## 8. Queda a criterio del builder
- Formato exacto del health check y tiempos de espera.
- Si la consola usa polling por offset (recomendado) o stream NDJSON con reconexión.
- Pruebas: utilidades puras con Jest (cálculo de versión, sugerencia de bump, parseo de commits/notas, filtro de no vistas); en app-pmy, Vitest para la lógica del aviso.

#!/usr/bin/env bash
# Despliegue de pmy-api desde main (Configuración → Servidor → Actualizar).
# Lo lanza la API desprendido de pm2 (setsid -f), así sobrevive al `pm2 restart`.
# Escribe una línea JSON por evento en <logDir>/<runId>.log y el resultado final
# en <logDir>/<runId>.status.json. Nunca escribe ni empuja a git.
#
# Uso: pmy-deploy.sh <runId> <logDir> <apiDir> <pm2Name> <healthUrl>
set -uo pipefail

RUN_ID="$1"; LOG_DIR="$2"; API_DIR="$3"; PM2_NAME="$4"; HEALTH_URL="$5"
LOG="$LOG_DIR/$RUN_ID.log"
STATUS="$LOG_DIR/$RUN_ID.status.json"
TOTAL=6
START_MS=$(date +%s%3N)
CURRENT_STEP=""
FROM_COMMIT=""
TO_COMMIT=""

mkdir -p "$LOG_DIR"
# Sin colores de terminal: la consola web no los entiende.
export NO_COLOR=1 FORCE_COLOR=0 NPM_CONFIG_COLOR=false
ESC=$(printf '\033')

json_str() {
  local s="$1"
  s=${s//\\/\\\\}; s=${s//\"/\\\"}; s=${s//$'\t'/\\t}; s=${s//$'\r'/}
  printf '%s' "$s" | tr -d '\000-\010\013-\037'
}
now_ms() { date +%s%3N; }
elapsed() { echo $(( $(now_ms) - START_MS )); }
emit() { printf '%s\n' "$1" >> "$LOG"; }
# Quita los códigos de color/estilo de la terminal (ESC[...m) que algunas herramientas igual mandan.
strip_ansi() { printf '%s' "$1" | sed -E "s/${ESC}\[[0-9;?]*[A-Za-z]//g"; }
emit_log() {
  local type="log" line
  line=$(strip_ansi "$1")
  case "$line" in *[Ww][Aa][Rr][Nn]*|*[Ee][Rr][Rr][Oo][Rr]*) type="warn" ;; esac
  emit "{\"type\":\"$type\",\"line\":\"$(json_str "$line")\",\"elapsedMs\":$(elapsed)}"
}
ok_line() { emit "{\"type\":\"skip\",\"key\":\"$CURRENT_STEP\",\"line\":\"$(json_str "$1")\",\"elapsedMs\":$(elapsed)}"; }
# emit_tail <archivo> <n>: muestra las últimas n líneas de una salida guardada (para fallas).
emit_tail() { tail -n "$2" "$1" 2>/dev/null | while IFS= read -r line; do emit_log "$line"; done; }
phase() { # phase <n> <key> <label>
  CURRENT_STEP="$2"
  emit "{\"type\":\"phase\",\"step\":$1,\"total\":$TOTAL,\"key\":\"$2\",\"label\":\"$(json_str "$3")\",\"elapsedMs\":$(elapsed)}"
}
skip() { emit "{\"type\":\"skip\",\"key\":\"$1\",\"line\":\"$(json_str "$2")\",\"elapsedMs\":$(elapsed)}"; }
write_status() { # write_status <status> <message>
  printf '{"status":"%s","step":"%s","message":"%s","fromApiCommit":"%s","toApiCommit":"%s","finishedAt":"%s","durationMs":%s}\n' \
    "$1" "$CURRENT_STEP" "$(json_str "$2")" "$FROM_COMMIT" "$TO_COMMIT" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(elapsed)" > "$STATUS.tmp"
  mv "$STATUS.tmp" "$STATUS"
}
fail() {
  emit "{\"type\":\"error\",\"key\":\"$CURRENT_STEP\",\"message\":\"$(json_str "$1")\",\"elapsedMs\":$(elapsed)}"
  write_status failed "$1"
  [ -n "${HB_PID:-}" ] && kill "$HB_PID" 2>/dev/null
  exit 1
}
# run <cmd...>: transmite la salida línea por línea y devuelve el código del comando.
run() {
  emit_log "\$ $*"
  "$@" 2>&1 | while IFS= read -r line; do emit_log "$line"; done
  return "${PIPESTATUS[0]}"
}

# Un solo despliegue a la vez.
exec 9>"$LOG_DIR/deploy.lock"
if ! flock -n 9; then
  CURRENT_STEP="fetch"; fail "Ya hay otra actualización en curso."
fi

# Latido cada 15 s para que la consola muestre que sigue trabajando.
( while sleep 15; do emit "{\"type\":\"heartbeat\",\"elapsedMs\":$(elapsed)}"; done ) &
HB_PID=$!
trap '[ -n "${HB_PID:-}" ] && kill "$HB_PID" 2>/dev/null' EXIT

cd "$API_DIR" || { CURRENT_STEP="fetch"; fail "No se encontró la carpeta del sistema ($API_DIR)."; }

# 1. Traer main
phase 1 fetch "Traer main"
BRANCH=$(git rev-parse --abbrev-ref HEAD)
[ "$BRANCH" = "main" ] || fail "El servidor está en la rama '$BRANCH', no en main. No se tocó nada."
[ -z "$(git status --porcelain --untracked-files=no)" ] || fail "Hay cambios hechos a mano en el servidor. No se tocó nada."
FROM_COMMIT=$(git rev-parse HEAD)
run git fetch origin main || fail "No se pudo traer main de GitHub."
run git merge --ff-only origin/main || fail "main no avanza en línea recta desde lo que hay en el servidor. No se tocó nada."
TO_COMMIT=$(git rev-parse HEAD)
emit_log "$(git rev-list --count "$FROM_COMMIT..$TO_COMMIT") cambios nuevos · ${FROM_COMMIT:0:7} → ${TO_COMMIT:0:7}"

# Sin cambios en el servidor (solo novedades de pantallas): no se compila ni se reinicia.
if [ "$FROM_COMMIT" = "$TO_COMMIT" ]; then
  for k in deps migrate build restart verify; do skip "$k" "Sin cambios en el servidor"; done
  write_status success "Solo se publicaron las novedades; el servidor no cambió."
  emit "{\"type\":\"done\",\"ok\":true,\"durationMs\":$(elapsed)}"
  exit 0
fi

# 2. Dependencias (solo si cambiaron)
phase 2 deps "Dependencias"
if git diff --quiet "$FROM_COMMIT" "$TO_COMMIT" -- package.json package-lock.json; then
  skip deps "Sin cambios en dependencias"
else
  run npm install --no-save --include=dev --no-audit --no-fund || fail "Falló la instalación de dependencias. La versión anterior sigue en línea."
fi

# 3. Migraciones (sin el registro de SQL; solo qué migración se aplicó)
phase 3 migrate "Migraciones"
MIG_OUT="$LOG_DIR/$RUN_ID.migrations.txt"
DB_LOGGING=false npm run --silent migration:run > "$MIG_OUT" 2>&1
MIG_RC=$?
APPLIED=0
while IFS= read -r line; do
  line=$(strip_ansi "$line")
  if [[ "$line" =~ Migration[[:space:]]+([A-Za-z0-9_]+)[[:space:]]+has[[:space:]]been[[:space:]]executed ]]; then
    ok_line "✓ Migración $(printf '%s' "${BASH_REMATCH[1]}" | sed -E 's/[0-9]{10,}$//') aplicada"; APPLIED=$((APPLIED + 1))
  fi
done < "$MIG_OUT"
if [ "$MIG_RC" -ne 0 ]; then
  emit_log "La migración falló. Últimas líneas:"
  emit_tail "$MIG_OUT" 40
  fail "Falló una migración de la base de datos. La versión anterior sigue en línea."
fi
[ "$APPLIED" -eq 0 ] && ok_line "✓ Sin migraciones nuevas"

# 4. Build en carpeta aparte (dist sigue sirviendo mientras tanto)
phase 4 build "Compilar"
rm -rf dist-next .tsconfig.deploy.json
cat > .tsconfig.deploy.json <<'EOF'
{
  "extends": "./tsconfig.build.json",
  "compilerOptions": { "outDir": "./dist-next", "tsBuildInfoFile": "./dist-next/tsconfig.build.tsbuildinfo" }
}
EOF
# nest build (igual que a mano): convierte los imports "src/..." en rutas relativas. Con tsc
# solo quedaban require("src/...") y la API no arrancaba.
BUILD_OUT="$LOG_DIR/$RUN_ID.build.txt"
npx nest build -p .tsconfig.deploy.json > "$BUILD_OUT" 2>&1
BUILD_RC=$?
rm -f .tsconfig.deploy.json
if [ "$BUILD_RC" -ne 0 ] || [ ! -f dist-next/main.js ]; then
  emit_log "La compilación falló. Últimas líneas:"
  emit_tail "$BUILD_OUT" 40
  fail "Falló la compilación. La versión anterior sigue en línea."
fi
# Candado: si quedara algún require("src/...") la API no arrancaría; mejor no reiniciar.
BAD=$(grep -rl --include=*.js 'require("src/' dist-next 2>/dev/null | head -3)
if [ -n "$BAD" ]; then
  emit_log "Archivos con rutas sin convertir: $BAD"
  fail "La compilación quedó incompleta. No se reinició; la versión anterior sigue en línea."
fi
ok_line "✓ Compilado sin errores"
for asset in config/ssl ssl; do
  if [ -d "src/$asset" ]; then mkdir -p "dist-next/$asset" && cp -r "src/$asset/." "dist-next/$asset/"; fi
done

# 5. Reiniciar (cambio de carpeta + pm2)
phase 5 restart "Reiniciar"
rm -rf dist-prev
mv dist dist-prev && mv dist-next dist || fail "No se pudo cambiar a la versión nueva. La versión anterior sigue en línea."
PM2_OUT="$LOG_DIR/$RUN_ID.pm2.txt"
if pm2 restart "$PM2_NAME" --silent > "$PM2_OUT" 2>&1; then
  emit_log "pm2 reinició $PM2_NAME"
else
  emit_tail "$PM2_OUT" 20
  rm -rf dist && mv dist-prev dist
  fail "pm2 no pudo reiniciar. Se regresó a la versión anterior."
fi

# 6. Verificar que la API responda
phase 6 verify "Verificar"
OK=0
for _ in $(seq 1 45); do
  if curl -fsS -m 3 "$HEALTH_URL" > /dev/null 2>&1; then OK=1; break; fi
  sleep 2
done
if [ "$OK" -ne 1 ]; then
  emit_log "La versión nueva no respondió en 90 s. Por qué no arrancó (últimas líneas del error):"
  pm2 logs "$PM2_NAME" --err --lines 30 --nostream --raw > "$PM2_OUT" 2>&1
  emit_tail "$PM2_OUT" 30
  emit_log "Regresando a la versión anterior…"
  rm -rf dist-failed && mv dist dist-failed && mv dist-prev dist
  pm2 restart "$PM2_NAME" --silent > /dev/null 2>&1
  fail "La versión nueva no arrancó. Se regresó a la anterior (las migraciones ya aplicadas se quedan)."
fi
ok_line "✓ El sistema respondió"

write_status success "Actualización terminada."
emit "{\"type\":\"done\",\"ok\":true,\"durationMs\":$(elapsed)}"

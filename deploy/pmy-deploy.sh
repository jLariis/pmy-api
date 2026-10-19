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

json_str() {
  local s="$1"
  s=${s//\\/\\\\}; s=${s//\"/\\\"}; s=${s//$'\t'/\\t}; s=${s//$'\r'/}
  printf '%s' "$s" | tr -d '\000-\010\013-\037'
}
now_ms() { date +%s%3N; }
elapsed() { echo $(( $(now_ms) - START_MS )); }
emit() { printf '%s\n' "$1" >> "$LOG"; }
emit_log() {
  local type="log"
  case "$1" in *[Ww][Aa][Rr][Nn]*|*[Ee][Rr][Rr][Oo][Rr]*) type="warn" ;; esac
  emit "{\"type\":\"$type\",\"line\":\"$(json_str "$1")\",\"elapsedMs\":$(elapsed)}"
}
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

# 3. Migraciones
phase 3 migrate "Migraciones"
run npm run migration:run || fail "Falló una migración de la base de datos. La versión anterior sigue en línea."

# 4. Build en carpeta aparte (dist sigue sirviendo mientras tanto)
phase 4 build "Compilar"
rm -rf dist-next .tsconfig.deploy.json
cat > .tsconfig.deploy.json <<'EOF'
{
  "extends": "./tsconfig.build.json",
  "compilerOptions": { "outDir": "./dist-next", "tsBuildInfoFile": "./dist-next/tsconfig.build.tsbuildinfo" }
}
EOF
run npx tsc -p .tsconfig.deploy.json
BUILD_RC=$?
rm -f .tsconfig.deploy.json
[ "$BUILD_RC" -eq 0 ] && [ -f dist-next/main.js ] || fail "Falló la compilación. La versión anterior sigue en línea."
for asset in config/ssl ssl; do
  if [ -d "src/$asset" ]; then mkdir -p "dist-next/$asset" && cp -r "src/$asset/." "dist-next/$asset/"; fi
done

# 5. Reiniciar (cambio de carpeta + pm2)
phase 5 restart "Reiniciar"
rm -rf dist-prev
mv dist dist-prev && mv dist-next dist || fail "No se pudo cambiar a la versión nueva. La versión anterior sigue en línea."
if ! run pm2 restart "$PM2_NAME"; then
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
  emit_log "La API no respondió en 90 s; regresando a la versión anterior…"
  rm -rf dist-failed && mv dist dist-failed && mv dist-prev dist
  run pm2 restart "$PM2_NAME"
  fail "La versión nueva no arrancó. Se regresó a la anterior (las migraciones ya aplicadas se quedan)."
fi
emit_log "La API respondió: $(curl -fsS -m 3 "$HEALTH_URL" 2>/dev/null)"

write_status success "Actualización terminada."
emit "{\"type\":\"done\",\"ok\":true,\"durationMs\":$(elapsed)}"

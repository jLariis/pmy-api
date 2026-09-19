#!/usr/bin/env bash
# Instala la suspensión/despertar programado del servidor (idempotente).
# Uso:
#   APP_USER=pmy APP_PORT=3000 sudo -E bash deploy/setup-power-schedule.sh
# Variables:
#   APP_USER      usuario que corre pmy-api (pm2). Default: SUDO_USER.
#   APP_PORT      puerto HTTP del backend para el hook de correo. Default: 3000.
#   POWER_SECRET  secreto compartido; si no se pasa, se genera y se persiste.
#   BACKEND_ENV   ruta del .env de la app. Default: /opt/pmy-api/.env.
set -euo pipefail

APP_USER="${APP_USER:-${SUDO_USER:-}}"
APP_PORT="${APP_PORT:-3000}"
[ -n "$APP_USER" ] || { echo "APP_USER requerido"; exit 1; }
[ "$(id -u)" = "0" ] || { echo "Corre con sudo"; exit 1; }

POWER_SECRET="${POWER_SECRET:-$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 40)}"

install -d -m 0755 /etc/pmy-power
install -d -m 0750 -o "$APP_USER" -g "$APP_USER" /var/lib/pmy-power

# Config del hook (secreto + puerto) — root, legible por el hook (root).
cat > /etc/pmy-power/notify.env <<EOF
POWER_SECRET=${POWER_SECRET}
APP_PORT=${APP_PORT}
EOF
chmod 0600 /etc/pmy-power/notify.env

# schedule.env inicial (lo reescribe pmy-power-apply).
[ -f /etc/pmy-power/schedule.env ] || cat > /etc/pmy-power/schedule.env <<'EOF'
ENABLED=1
SUSPEND_TIME=21:30
WAKE_TIME=06:00
DAYS=Mon,Tue,Wed,Thu,Fri,Sat
EOF

# ---- pmy-power-apply: lee desired.json, valida, reescribe unidad + schedule.env ----
cat > /usr/local/sbin/pmy-power-apply <<'APPLY'
#!/usr/bin/env bash
set -euo pipefail
DESIRED=/var/lib/pmy-power/desired.json
[ -f "$DESIRED" ] || { echo "no existe $DESIRED" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq no instalado" >&2; exit 1; }

ENABLED=$(jq -r '.enabled' "$DESIRED")
SUSPEND=$(jq -r '.suspendTime' "$DESIRED")
WAKE=$(jq -r '.wakeTime' "$DESIRED")
mapfile -t DAYS < <(jq -r '.days[]' "$DESIRED")

# Validación estricta (anti-inyección en unit files).
[[ "$SUSPEND" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]] || { echo "suspendTime inválido: $SUSPEND" >&2; exit 2; }
[[ "$WAKE"    =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]] || { echo "wakeTime inválido: $WAKE" >&2; exit 2; }
declare -A MAP=( [1]=Mon [2]=Tue [3]=Wed [4]=Thu [5]=Fri [6]=Sat [7]=Sun )
TOKENS=()
for d in "${DAYS[@]}"; do
  [[ "$d" =~ ^[1-7]$ ]] || { echo "día inválido: $d" >&2; exit 2; }
  TOKENS+=("${MAP[$d]}")
done
[ "${#TOKENS[@]}" -gt 0 ] || { echo "sin días" >&2; exit 2; }
DAYSTR=$(IFS=,; echo "${TOKENS[*]}")

cat > /etc/pmy-power/schedule.env <<EOF
ENABLED=${ENABLED}
SUSPEND_TIME=${SUSPEND}
WAKE_TIME=${WAKE}
DAYS=${DAYSTR}
EOF

# Drop-in con el OnCalendar calculado.
install -d -m 0755 /etc/systemd/system/pmy-power-suspend.timer.d
cat > /etc/systemd/system/pmy-power-suspend.timer.d/schedule.conf <<EOF
[Timer]
OnCalendar=
OnCalendar=${DAYSTR} *-*-* ${SUSPEND}:00
EOF

systemctl daemon-reload
if [ "$ENABLED" = "true" ] || [ "$ENABLED" = "1" ]; then
  systemctl enable --now pmy-power-suspend.timer
else
  systemctl disable --now pmy-power-suspend.timer || true
fi
echo "aplicado: ${DAYSTR} ${SUSPEND} (wake ${WAKE}, enabled=${ENABLED})"
APPLY
chmod 0755 /usr/local/sbin/pmy-power-apply

# ---- pmy-power-suspend: arma RTC y suspende (por vía systemd, para disparar hooks) ----
cat > /usr/local/sbin/pmy-power-suspend <<'SUSP'
#!/usr/bin/env bash
set -euo pipefail
source /etc/pmy-power/schedule.env
[ "${ENABLED:-1}" = "1" ] || { echo "deshabilitado; no suspende"; exit 0; }
[ -e /sys/class/rtc/rtc0 ] || { echo "sin RTC (/sys/class/rtc/rtc0); NO se suspende" >&2; exit 1; }

# Próxima ocurrencia de WAKE_TIME (hoy si aún no pasa, si no mañana).
WAKE_EPOCH=$(date -d "today ${WAKE_TIME}" +%s)
[ "$WAKE_EPOCH" -le "$(date +%s)" ] && WAKE_EPOCH=$(date -d "tomorrow ${WAKE_TIME}" +%s)

# -m no: SOLO arma la alarma del RTC (no suspende). Si falla, abortar.
if ! rtcwake -m no -t "$WAKE_EPOCH"; then
  echo "no se pudo armar la alarma RTC; NO se suspende" >&2
  exit 1
fi
# Suspende por systemd (dispara /usr/lib/systemd/system-sleep/*).
systemctl suspend
SUSP
chmod 0755 /usr/local/sbin/pmy-power-suspend

# ---- hook de sleep: correos pre (suspend) / post (wake) ----
cat > /usr/lib/systemd/system-sleep/pmy-power <<'HOOK'
#!/usr/bin/env bash
# $1 = pre|post ; $2 = suspend|hibernate|...
set -euo pipefail
[ -f /etc/pmy-power/notify.env ] || exit 0
source /etc/pmy-power/notify.env
URL="http://127.0.0.1:${APP_PORT}/server/power/internal/notify"

notify() {
  local event="$1"
  curl -fsS -m 15 -X POST "$URL" \
    -H "X-Power-Secret: ${POWER_SECRET}" \
    -H 'Content-Type: application/json' \
    -d "{\"event\":\"${event}\"}" >/dev/null 2>&1 || true
}

case "$1" in
  pre)  notify suspend ;;
  post)
    # Espera breve a que regrese la red tras el resume, luego avisa.
    for i in $(seq 1 10); do
      curl -fsS -m 3 "http://127.0.0.1:${APP_PORT}" >/dev/null 2>&1 && break
      sleep 2
    done
    notify wake
    ;;
esac
HOOK
chmod 0755 /usr/lib/systemd/system-sleep/pmy-power

# ---- unidades systemd ----
cat > /etc/systemd/system/pmy-power-suspend.service <<'UNIT'
[Unit]
Description=PMY suspend programado (arma RTC + suspend)
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/pmy-power-suspend
UNIT

cat > /etc/systemd/system/pmy-power-suspend.timer <<'UNIT'
[Unit]
Description=PMY timer de suspensión programada
[Timer]
OnCalendar=Mon,Tue,Wed,Thu,Fri,Sat *-*-* 21:30:00
Persistent=false
[Install]
WantedBy=timers.target
UNIT

# ---- sudoers acotado: la app solo puede correr pmy-power-apply ----
cat > /etc/sudoers.d/pmy-power <<EOF
${APP_USER} ALL=(root) NOPASSWD: /usr/local/sbin/pmy-power-apply
EOF
chmod 0440 /etc/sudoers.d/pmy-power
visudo -cf /etc/sudoers.d/pmy-power

# ---- inyecta POWER_SECRET / POWER_NOTIFY_PORT en el .env de la app si falta ----
APP_ENV="${BACKEND_ENV:-/opt/pmy-api/.env}"
if [ -f "$APP_ENV" ]; then
  grep -q '^POWER_SECRET=' "$APP_ENV" || echo "POWER_SECRET=${POWER_SECRET}" >> "$APP_ENV"
  grep -q '^POWER_NOTIFY_PORT=' "$APP_ENV" || echo "POWER_NOTIFY_PORT=${APP_PORT}" >> "$APP_ENV"
  echo "→ Revisa $APP_ENV (POWER_SECRET/POWER_NOTIFY_PORT) y reinicia: pm2 restart pmy-api"
else
  echo "⚠ No encontré $APP_ENV. Agrega manualmente: POWER_SECRET=${POWER_SECRET}"
fi

systemctl daemon-reload
echo "OK. Instalado. jq requerido (apt-get install -y jq si falta)."

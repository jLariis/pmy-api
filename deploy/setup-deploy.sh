#!/usr/bin/env bash
# Prepara el servidor para el botón "Actualizar" (Configuración → Servidor → Actualizar).
# Idempotente. Correr UNA vez con sudo:
#
#   APP_USER=<usuario_pm2> API_DIR=/opt/pmy-api WEB_REPO_URL=git@github.com:<org>/app-pmy.git \
#     sudo -E bash deploy/setup-deploy.sh
#
# Variables:
#   APP_USER      usuario que corre pm2/pmy-api. Default: SUDO_USER.
#   API_DIR       carpeta de pmy-api. Default: /opt/pmy-api.
#   WEB_DIR       copia SOLO LECTURA de app-pmy (para leer sus notas). Default: /opt/app-pmy-notes.
#   WEB_REPO_URL  url git de app-pmy. Si se omite, no se leen notas del frontend.
#   LOG_DIR       bitácoras de despliegue. Default: /var/lib/pmy-deploy.
#   PM2_NAME      nombre del proceso en pm2. Default: pmy-api.
set -euo pipefail

APP_USER="${APP_USER:-${SUDO_USER:-}}"
API_DIR="${API_DIR:-/opt/pmy-api}"
WEB_DIR="${WEB_DIR:-/opt/app-pmy-notes}"
WEB_REPO_URL="${WEB_REPO_URL:-}"
LOG_DIR="${LOG_DIR:-/var/lib/pmy-deploy}"
PM2_NAME="${PM2_NAME:-pmy-api}"
ENV_FILE="$API_DIR/.env"

[ -n "$APP_USER" ] || { echo "Falta APP_USER"; exit 1; }
[ -d "$API_DIR/.git" ] || { echo "No es un repo git: $API_DIR"; exit 1; }

echo "→ Herramientas necesarias"
for bin in git setsid flock curl bash; do
  command -v "$bin" >/dev/null || { echo "Falta '$bin' (sudo apt-get install -y util-linux curl git)"; exit 1; }
done
sudo -u "$APP_USER" bash -lc 'command -v pm2 >/dev/null' || { echo "pm2 no está en el PATH de $APP_USER"; exit 1; }

echo "→ Carpeta de bitácoras $LOG_DIR"
mkdir -p "$LOG_DIR"
chown "$APP_USER":"$APP_USER" "$LOG_DIR"
chmod 750 "$LOG_DIR"

echo "→ pmy-api debe estar en main y poder traer de GitHub"
BRANCH=$(sudo -u "$APP_USER" git -C "$API_DIR" rev-parse --abbrev-ref HEAD)
[ "$BRANCH" = "main" ] || echo "  ⚠ $API_DIR está en '$BRANCH'. El botón solo funciona en main."
sudo -u "$APP_USER" git -C "$API_DIR" fetch --quiet origin main && echo "  ✓ git fetch OK"

if [ -n "$WEB_REPO_URL" ]; then
  echo "→ Copia de solo lectura de app-pmy en $WEB_DIR"
  if [ ! -d "$WEB_DIR/.git" ]; then
    mkdir -p "$(dirname "$WEB_DIR")"
    sudo -u "$APP_USER" git clone --quiet --branch main --single-branch "$WEB_REPO_URL" "$WEB_DIR" 2>/dev/null \
      || { mkdir -p "$WEB_DIR" && chown "$APP_USER":"$APP_USER" "$WEB_DIR" && sudo -u "$APP_USER" git clone --quiet --branch main --single-branch "$WEB_REPO_URL" "$WEB_DIR"; }
  fi
  sudo -u "$APP_USER" git -C "$WEB_DIR" fetch --quiet origin main && echo "  ✓ app-pmy fetch OK"
fi

echo "→ Variables en $ENV_FILE"
add_env() { grep -q "^$1=" "$ENV_FILE" 2>/dev/null || echo "$1=$2" >> "$ENV_FILE"; }
add_env DEPLOY_ENABLED 1
add_env DEPLOY_API_DIR "$API_DIR"
add_env DEPLOY_LOG_DIR "$LOG_DIR"
add_env DEPLOY_PM2_NAME "$PM2_NAME"
[ -n "$WEB_REPO_URL" ] && add_env DEPLOY_WEB_REPO_DIR "$WEB_DIR"
chown "$APP_USER":"$APP_USER" "$ENV_FILE"

echo
echo "Listo. Pasos finales (como $APP_USER):"
echo "  cd $API_DIR && npm run migration:run && npm run build && pm2 restart $PM2_NAME"
echo "Desde ahí, las siguientes actualizaciones se hacen con el botón."

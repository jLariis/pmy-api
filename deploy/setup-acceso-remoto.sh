#!/usr/bin/env bash
# ============================================================================
#  Acceso Remoto (Apache Guacamole) — instalador para Ubuntu Server 24.04
#  Instala guacd + plugins (VNC/RDP/SSH), x11vnc (Xorg :0) como servicio,
#  ata todo a loopback, genera la clave AES y parcha el .env del backend.
#  Idempotente: se puede re-ejecutar sin romper nada.
#
#  Uso:
#    sudo bash deploy/setup-acceso-remoto.sh
#  Variables opcionales (no interactivo):
#    DESKTOP_USER=juan  BACKEND_ENV=/opt/pmy-api/.env  VNC_PASSWORD=secreto \
#    SSH_USER=admin SSH_PASSWORD=... sudo -E bash deploy/setup-acceso-remoto.sh
# ============================================================================
set -euo pipefail

# ---- helpers ---------------------------------------------------------------
c_g="\033[0;32m"; c_y="\033[1;33m"; c_r="\033[0;31m"; c_b="\033[1;34m"; c_0="\033[0m"
ok()   { echo -e "${c_g}[OK]${c_0} $*"; }
info() { echo -e "${c_b}[..]${c_0} $*"; }
warn() { echo -e "${c_y}[!!]${c_0} $*"; }
die()  { echo -e "${c_r}[XX]${c_0} $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Ejecuta con sudo:  sudo bash $0"
. /etc/os-release 2>/dev/null || true
[ "${VERSION_ID:-}" = "24.04" ] || warn "Probado en Ubuntu 24.04 (detectado: ${VERSION_ID:-desconocido}). Continúo…"

# ---- 0. Parámetros ---------------------------------------------------------
DESKTOP_USER="${DESKTOP_USER:-${SUDO_USER:-}}"
if [ -z "${DESKTOP_USER}" ] || [ "${DESKTOP_USER}" = "root" ]; then
  read -rp "Usuario dueño del escritorio gráfico (sesión en :0): " DESKTOP_USER
fi
id "${DESKTOP_USER}" >/dev/null 2>&1 || die "El usuario '${DESKTOP_USER}' no existe."
USER_HOME="$(getent passwd "${DESKTOP_USER}" | cut -d: -f6)"
VNC_PORT="${VNC_PORT:-5901}"

info "Usuario escritorio: ${DESKTOP_USER}  (home: ${USER_HOME})"

# ---- 1. Paquetes -----------------------------------------------------------
info "Instalando guacd + plugins + x11vnc…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y \
  guacd libguac-client-vnc0 libguac-client-rdp0 libguac-client-ssh0 \
  x11vnc openssl
ok "Paquetes instalados."

# ---- 2. Aviso Wayland ------------------------------------------------------
SESS_TYPE="$(loginctl show-session "$(loginctl 2>/dev/null | awk -v u="${DESKTOP_USER}" '$3==u{print $1; exit}')" -p Type --value 2>/dev/null || true)"
if [ "${SESS_TYPE}" = "wayland" ]; then
  warn "La sesión gráfica es WAYLAND: x11vnc NO puede capturar :0."
  warn "Desactiva Wayland: en /etc/gdm3/custom.conf pon 'WaylandEnable=false', reinicia, y re-ejecuta."
fi

# ---- 3. guacd en loopback --------------------------------------------------
info "Configurando guacd (bind 127.0.0.1:4822)…"
mkdir -p /etc/guacamole
cat > /etc/guacamole/guacd.conf <<'EOF'
[server]
bind_host = 127.0.0.1
bind_port = 4822
EOF
systemctl enable guacd >/dev/null 2>&1 || true
systemctl restart guacd
ok "guacd activo en 127.0.0.1:4822."

# ---- 4. Password VNC -------------------------------------------------------
VNC_PASS_FILE="${USER_HOME}/.vnc/passwd"
if [ ! -f "${VNC_PASS_FILE}" ] || [ "${FORCE_VNC:-0}" = "1" ]; then
  if [ -z "${VNC_PASSWORD:-}" ]; then
    read -rsp "Define la contraseña VNC (para el escritorio): " VNC_PASSWORD; echo
  fi
  [ -n "${VNC_PASSWORD}" ] || die "Contraseña VNC vacía."
  install -d -o "${DESKTOP_USER}" -g "${DESKTOP_USER}" -m 700 "${USER_HOME}/.vnc"
  sudo -u "${DESKTOP_USER}" x11vnc -storepasswd "${VNC_PASSWORD}" "${VNC_PASS_FILE}" >/dev/null
  chmod 600 "${VNC_PASS_FILE}"
  ok "Password VNC guardada en ${VNC_PASS_FILE}."
else
  ok "Password VNC ya existe (${VNC_PASS_FILE}); usa FORCE_VNC=1 para regenerarla."
fi

# ---- 5. Servicio x11vnc (Xorg :0, solo localhost) --------------------------
info "Instalando servicio systemd x11vnc…"
cat > /etc/systemd/system/x11vnc.service <<EOF
[Unit]
Description=x11vnc (Xorg :0, solo localhost) para Apache Guacamole
After=display-manager.service network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${DESKTOP_USER}
Environment=DISPLAY=:0
ExecStart=/usr/bin/x11vnc -display :0 -auth guess -rfbauth ${VNC_PASS_FILE} -localhost -rfbport ${VNC_PORT} -forever -shared -noxdamage -o /var/log/x11vnc.log
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
touch /var/log/x11vnc.log && chown "${DESKTOP_USER}" /var/log/x11vnc.log || true
systemctl daemon-reload
systemctl enable x11vnc >/dev/null 2>&1 || true
systemctl restart x11vnc || warn "x11vnc no arrancó (¿sesión gráfica activa en :0?). Revisa: journalctl -u x11vnc -e"
ok "Servicio x11vnc instalado (puerto ${VNC_PORT}, localhost)."

# ---- 6. Variables del backend (.env) --------------------------------------
BACKEND_ENV="${BACKEND_ENV:-}"
if [ -z "${BACKEND_ENV}" ]; then
  read -rp "Ruta del .env del backend NestJS (enter para omitir y solo imprimir): " BACKEND_ENV || true
fi
GUAC_KEY="$(openssl rand -hex 32)"

write_env() {
  local f="$1"
  if grep -q '^GUAC_TOKEN_KEY=' "$f" 2>/dev/null; then
    warn "GUAC_TOKEN_KEY ya existe en ${f}: NO se sobrescribe."
  else
    {
      echo ""
      echo "# --- Acceso Remoto (Guacamole) — generado $(date -Iseconds) ---"
      echo "GUAC_TOKEN_KEY=${GUAC_KEY}"
      echo "GUACD_HOST=127.0.0.1"
      echo "GUACD_PORT=4822"
      echo "REMOTE_HOST=127.0.0.1"
      echo "REMOTE_VNC_PORT=${VNC_PORT}"
      echo "REMOTE_VNC_PASSWORD=${VNC_PASSWORD:-CAMBIA_ESTO}"
      echo "REMOTE_SSH_PORT=22"
      echo "REMOTE_SSH_USER=${SSH_USER:-CAMBIA_ESTO}"
      echo "REMOTE_SSH_PASSWORD=${SSH_PASSWORD:-CAMBIA_ESTO}"
    } >> "$f"
    ok "Variables añadidas a ${f}."
  fi
}

if [ -n "${BACKEND_ENV}" ] && [ -f "${BACKEND_ENV}" ]; then
  write_env "${BACKEND_ENV}"
else
  warn "No se parchó ningún .env. Agrega manualmente:"
  cat <<EOF
    GUAC_TOKEN_KEY=${GUAC_KEY}
    GUACD_HOST=127.0.0.1
    GUACD_PORT=4822
    REMOTE_HOST=127.0.0.1
    REMOTE_VNC_PORT=${VNC_PORT}
    REMOTE_VNC_PASSWORD=<tu-password-vnc>
    REMOTE_SSH_PORT=22
    REMOTE_SSH_USER=<usuario-ssh>
    REMOTE_SSH_PASSWORD=<password-ssh>
EOF
fi

# ---- 7. Verificación -------------------------------------------------------
echo; info "Verificación de puertos (deben estar SOLO en 127.0.0.1):"
ss -ltnp 2>/dev/null | grep -E ':(4822|'"${VNC_PORT}"')\b' || warn "No veo 4822/${VNC_PORT} escuchando aún."
echo
systemctl --no-pager --lines=0 status guacd  || true
systemctl --no-pager --lines=0 status x11vnc || true

echo
ok "Instalación de servidor completa."
echo -e "${c_y}Faltan pasos que NO hace este script:${c_0}"
echo "  1) Nginx: pega deploy/nginx-acceso-remoto.conf en tu server{} (ruta /ws/guacamole) y: sudo nginx -t && sudo systemctl reload nginx"
echo "  2) Rellena REMOTE_SSH_USER/REMOTE_SSH_PASSWORD en el .env si quedaron en CAMBIA_ESTO"
echo "  3) Reinicia el backend NestJS:  nest build && pm2 restart pmy-api  (o tu gestor)"
echo "  4) Entra como SUPERADMIN → menú 'Acceso Remoto' → Conectar"
echo
echo "Logs útiles:  journalctl -u guacd -f   |   tail -f /var/log/x11vnc.log"

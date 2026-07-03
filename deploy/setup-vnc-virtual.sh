#!/usr/bin/env bash
# ============================================================================
#  Escritorio VIRTUAL (TigerVNC + XFCE) para Ubuntu Server 24.04
#  Úsalo cuando NO hay una sesión Xorg física en :0 (servidor headless).
#  Crea un display :1 SIEMPRE disponible (puerto 5901, solo localhost) al que
#  guacd se conecta. Deshabilita el x11vnc que fallaba. Idempotente.
#
#    sudo bash deploy/setup-vnc-virtual.sh
#    DESKTOP_USER=pmy-admin VNC_PASSWORD=... GEOMETRY=1600x900 sudo -E bash deploy/setup-vnc-virtual.sh
#
#  REMOTE_VNC_PORT sigue siendo 5901 → NO cambies el .env.
# ============================================================================
set -euo pipefail
c_g="\033[0;32m"; c_y="\033[1;33m"; c_r="\033[0;31m"; c_b="\033[1;34m"; c_0="\033[0m"
ok(){ echo -e "${c_g}[OK]${c_0} $*"; }; info(){ echo -e "${c_b}[..]${c_0} $*"; }
warn(){ echo -e "${c_y}[!!]${c_0} $*"; }; die(){ echo -e "${c_r}[XX]${c_0} $*">&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Ejecuta con sudo:  sudo bash $0"

DESKTOP_USER="${DESKTOP_USER:-${SUDO_USER:-}}"
[ -n "${DESKTOP_USER}" ] && [ "${DESKTOP_USER}" != "root" ] || read -rp "Usuario del escritorio: " DESKTOP_USER
id "${DESKTOP_USER}" >/dev/null 2>&1 || die "El usuario '${DESKTOP_USER}' no existe."
USER_HOME="$(getent passwd "${DESKTOP_USER}" | cut -d: -f6)"
GEOMETRY="${GEOMETRY:-1600x900}"
VNC_PORT=5901   # display :1 = 5900 + 1

# ---- 1. Paquetes (TigerVNC + XFCE) ----------------------------------------
info "Instalando TigerVNC + XFCE (puede tardar)…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y tigervnc-standalone-server tigervnc-common \
  xfce4 xfce4-goodies dbus-x11 openssl
ok "Paquetes instalados."

# ---- 2. Deshabilitar x11vnc (conflictivo en headless) ----------------------
if systemctl list-unit-files 2>/dev/null | grep -q '^x11vnc.service'; then
  systemctl disable --now x11vnc >/dev/null 2>&1 || true
  ok "x11vnc.service detenido/deshabilitado (usaremos el escritorio virtual)."
fi

# ---- 3. Password VNC (reusa el existente si ya está) -----------------------
VNC_DIR="${USER_HOME}/.vnc"; VNC_PASS="${VNC_DIR}/passwd"
install -d -o "${DESKTOP_USER}" -g "${DESKTOP_USER}" -m 700 "${VNC_DIR}"
if [ ! -f "${VNC_PASS}" ] || [ "${FORCE_VNC:-0}" = "1" ]; then
  [ -n "${VNC_PASSWORD:-}" ] || { read -rsp "Contraseña VNC: " VNC_PASSWORD; echo; }
  [ -n "${VNC_PASSWORD}" ] || die "Contraseña VNC vacía."
  sudo -u "${DESKTOP_USER}" bash -c "umask 077; printf '%s\n' '${VNC_PASSWORD}' | vncpasswd -f > '${VNC_PASS}'"
  chmod 600 "${VNC_PASS}"; ok "Password VNC guardada."
else
  ok "Password VNC ya existe (usa FORCE_VNC=1 para regenerarla)."
fi

# ---- 4. xstartup (lanza XFCE) ---------------------------------------------
cat > "${VNC_DIR}/xstartup" <<'EOF'
#!/bin/sh
unset SESSION_MANAGER
unset DBUS_SESSION_BUS_ADDRESS
export XKL_XMODMAP_DISABLE=1
[ -r "$HOME/.Xresources" ] && xrdb "$HOME/.Xresources"
exec dbus-launch --exit-with-session startxfce4
EOF
chmod +x "${VNC_DIR}/xstartup"
chown -R "${DESKTOP_USER}:${DESKTOP_USER}" "${VNC_DIR}"
ok "xstartup (XFCE) configurado."

# ---- 5. Servicio systemd (display :1, localhost) --------------------------
info "Instalando servicio vncdesktop (:1)…"
cat > /etc/systemd/system/vncdesktop.service <<EOF
[Unit]
Description=TigerVNC escritorio virtual (:1, solo localhost) para Guacamole
After=syslog.target network.target

[Service]
Type=simple
User=${DESKTOP_USER}
WorkingDirectory=${USER_HOME}
Environment=HOME=${USER_HOME}
ExecStartPre=-/usr/bin/vncserver -kill :1
ExecStart=/usr/bin/vncserver :1 -localhost yes -geometry ${GEOMETRY} -depth 24 -fg
ExecStop=/usr/bin/vncserver -kill :1
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable vncdesktop >/dev/null 2>&1 || true
systemctl restart vncdesktop || warn "vncdesktop no arrancó; revisa: journalctl -u vncdesktop -e"
sleep 2

# ---- 6. Verificación -------------------------------------------------------
echo; info "Puerto VNC (debe estar SOLO en 127.0.0.1):"
ss -ltnp 2>/dev/null | grep -E ":${VNC_PORT}\b" || warn "No veo ${VNC_PORT} escuchando (revisa el log)."
systemctl --no-pager --lines=0 status vncdesktop || true
echo
ok "Escritorio virtual listo en 127.0.0.1:${VNC_PORT} (display :1, ${GEOMETRY})."
echo "  El .env no cambia (REMOTE_VNC_PORT=5901). Reinicia el backend y prueba la pestaña Escritorio."
echo "  Log: journalctl -u vncdesktop -f   |   ${VNC_DIR}/*.log"

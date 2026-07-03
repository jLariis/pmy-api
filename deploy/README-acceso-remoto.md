# Acceso Remoto (Apache Guacamole) — despliegue en Ubuntu

## ⚡ Rápido: script todo-en-uno (Ubuntu 24.04)
Hace los pasos 1–3 (guacd + plugins, x11vnc + servicio, guacd.conf en loopback,
clave AES y parcheo del `.env`). Idempotente.
```bash
sudo bash deploy/setup-acceso-remoto.sh
# no interactivo:
DESKTOP_USER=juan BACKEND_ENV=/opt/pmy-api/.env VNC_PASSWORD=... \
  SSH_USER=admin SSH_PASSWORD=... sudo -E bash deploy/setup-acceso-remoto.sh
```
Después solo faltan **Nginx** (paso 4) y **reiniciar el backend** (paso 5).
Si prefieres a mano, sigue los pasos de abajo.

---

Orden de pasos en el servidor físico (Xeon / Xorg, Wayland deshabilitado).

## 1. guacd + plugins (VNC/RDP/SSH)
```bash
sudo apt update
sudo apt install -y guacd libguac-client-vnc0 libguac-client-rdp0 libguac-client-ssh0
sudo cp deploy/guacd.conf /etc/guacamole/guacd.conf     # bind 127.0.0.1:4822
sudo systemctl enable --now guacd
sudo systemctl restart guacd && systemctl status guacd
```

## 2. x11vnc para el escritorio físico (:0)
```bash
sudo apt install -y x11vnc
sudo -u <USUARIO> x11vnc -storepasswd                    # crea /home/<USUARIO>/.vnc/passwd
sudo cp deploy/x11vnc.service /etc/systemd/system/x11vnc.service
sudo nano /etc/systemd/system/x11vnc.service            # reemplaza <USUARIO>
sudo systemctl daemon-reload && sudo systemctl enable --now x11vnc
systemctl status x11vnc
```
> SSH ya lo cubre `sshd` (127.0.0.1:22). Para RDP: `sudo apt install -y xrdp` y usa `protocol:'rdp'`.

## 3. Variables del backend
Copia el bloque de `.env.example` a tu `.env` real y llénalo:
```bash
openssl rand -hex 32      # → GUAC_TOKEN_KEY (32 bytes hex)
```
`REMOTE_VNC_PASSWORD` = el que pusiste en `x11vnc -storepasswd`.
`REMOTE_SSH_USER` / `REMOTE_SSH_PASSWORD` = una cuenta del servidor.

## 4. Nginx
Pega `deploy/nginx-acceso-remoto.conf` en tu `server{}` (ajusta `PUERTO_BACKEND`), luego:
```bash
sudo nginx -t && sudo systemctl reload nginx
```

## 5. Reiniciar backend
```bash
cd /ruta/pmy-api && nest build && pm2 restart pmy-api   # o tu gestor
```

## Verificación
- `ss -ltnp | grep -E '4822|5901'` → ambos SOLO en 127.0.0.1.
- En el panel, como **superadmin**: Menú → **Acceso Remoto** → pestaña Escritorio/Terminal → **Conectar**.
- Logs: `journalctl -u guacd -f`, `tail -f /var/log/x11vnc.log`, y el backend (`GuacamoleGateway`).

## Seguridad
- Puertos 4822 y 5901 **nunca** públicos (bind loopback). El acceso entra por tu `443` (Nginx → NestJS WSS).
- Feature EXCLUSIVA superadmin (validado en el handshake WS + `SuperAdminGuard` en el REST). Sin permiso RBAC grantable.

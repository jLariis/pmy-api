# Suspensión/Despertar programado del servidor

Instala systemd + rtcwake para suspender el servidor (default 21:30, L–S) y
despertarlo (default 06:00), con alertas por correo. Los horarios se editan
desde la app en **Configuración → Servidor** (solo superadmin).

## Cómo funciona

- Un **timer de systemd** (`pmy-power-suspend.timer`) dispara a la hora/días configurados.
- El servicio corre `/usr/local/sbin/pmy-power-suspend`, que **arma la alarma del RTC**
  (`rtcwake -m no -t <próximo wake>`) y luego suspende con `systemctl suspend`.
  Si no logra armar el RTC, **NO** suspende (salvaguarda anti "dormido para siempre").
- El hook `/usr/lib/systemd/system-sleep/pmy-power` llama al backend
  (`POST /server/power/internal/notify`) en `pre` (correo "se suspendió") y en `post`
  (correo "despertó"), autenticado con `X-Power-Secret`.
- La app guarda la config en BD y la aplica con `sudo /usr/local/sbin/pmy-power-apply`
  (único comando permitido por sudoers), que lee `/var/lib/pmy-power/desired.json`,
  reescribe el `OnCalendar` del timer y `/etc/pmy-power/schedule.env`.

## Requisitos

- Máquina física con RTC: `ls /sys/class/rtc/rtc0`.
- `jq` instalado: `sudo apt-get install -y jq`.

## Instalar (una vez)

```bash
APP_USER=<usuario_pm2> APP_PORT=3000 BACKEND_ENV=/opt/pmy-api/.env \
  sudo -E bash deploy/setup-power-schedule.sh
```

Luego revisa `POWER_SECRET`/`POWER_NOTIFY_PORT` en el `.env` y `pm2 restart pmy-api`.
El mismo `POWER_SECRET` queda en `/etc/pmy-power/notify.env` (lo usa el hook) y en el
`.env` de la app (lo valida `PowerSecretGuard`).

## Probar el despertar por RTC (sin esperar a la noche)

```bash
sudo rtcwake -m no -t $(date -d '+2 min' +%s) && sudo systemctl suspend
```

Debe despertar solo en ~2 min y llegar los correos de suspend/wake.

## Verificar

- `systemctl status pmy-power-suspend.timer`
- `systemctl list-timers | grep pmy-power`
- `journalctl -u pmy-power-suspend.service -e`
- Probar apply manual: escribe un `desired.json` y corre `sudo /usr/local/sbin/pmy-power-apply`.

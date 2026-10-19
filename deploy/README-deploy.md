# Actualizar el servidor desde la app

Botón **Configuración → Servidor → Actualizar** (solo superadmin). Hace lo mismo que a mano:
traer `main`, instalar dependencias (solo si cambiaron), correr migraciones, compilar y
`pm2 restart`, con consola en vivo. Además sube la versión del sistema y publica el aviso
de novedades para los usuarios.

## Cómo funciona

- La API lanza `deploy/pmy-deploy.sh` **desprendido de pm2** (`setsid -f`), así el reinicio
  de la propia API no lo corta.
- El script escribe una línea JSON por evento en `/var/lib/pmy-deploy/<id>.log` y el
  resultado en `<id>.status.json`. La pantalla lee la bitácora por partes y se reconecta
  sola cuando la API vuelve.
- Compila en `dist-next/` mientras `dist/` sigue sirviendo; en el reinicio cambia
  `dist → dist-prev` y `dist-next → dist`. Si la API nueva no responde en 90 s, regresa
  sola a `dist-prev` (las migraciones ya aplicadas se quedan).
- Un solo despliegue a la vez (`flock`). Si el servidor no está en `main` o tiene cambios
  hechos a mano, **no toca nada**.
- El servidor **nunca** escribe ni empuja a git.

## Notas de novedades

Cada cambio visible trae su nota en `release-notes/pending/AAAA-MM-DD-<slug>.json` del repo
donde se hizo (pmy-api o app-pmy):

```json
{
  "kind": "nuevo",
  "title": "Tareas del día",
  "summary": "Ahora cada sucursal ve qué le falta hacer hoy.",
  "where": "Ícono de tareas en la barra de arriba",
  "route": "/tareas",
  "steps": ["Toca el ícono de tareas.", "Revisa lo pendiente.", "Al terminar, se marca solo."],
  "audience": "todos"
}
```

`kind`: `nuevo` | `mejora` | `rapido` | `correccion`. `audience`: `todos` | `superadmin`.
Los archivos no se borran: la BD recuerda cuáles ya se publicaron.

## Instalar (una vez)

```bash
APP_USER=<usuario_pm2> API_DIR=/opt/pmy-api WEB_REPO_URL=git@github.com:<org>/app-pmy.git \
  sudo -E bash deploy/setup-deploy.sh
```

Después, a mano por última vez: `npm run migration:run && npm run build && pm2 restart pmy-api`.

## Variables (.env)

| Variable | Default | Para qué |
|---|---|---|
| `DEPLOY_ENABLED` | (apagado) | `1` habilita el botón (solo en el servidor) |
| `DEPLOY_API_DIR` | carpeta actual | repo de pmy-api |
| `DEPLOY_WEB_REPO_DIR` | (sin) | copia solo lectura de app-pmy para leer sus notas |
| `DEPLOY_PM2_NAME` | `pmy-api` | proceso a reiniciar |
| `DEPLOY_LOG_DIR` | `/var/lib/pmy-deploy` | bitácoras |
| `DEPLOY_HEALTH_URL` | `http://127.0.0.1:$PORT/api/system/release/current` | confirma que la API volvió |

## Si algo sale mal

- `ls -t /var/lib/pmy-deploy | head` y `cat <id>.log` muestran todo lo que pasó.
- Regresar a mano a la versión anterior: `mv dist dist-failed && mv dist-prev dist && pm2 restart pmy-api`.

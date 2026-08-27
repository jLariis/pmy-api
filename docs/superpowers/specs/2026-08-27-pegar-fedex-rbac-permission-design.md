# Diseño — Pegar FedEx (experimental) gateado por RBAC

Fecha: 2026-08-27
Autor: Javier (con Claude, rol Dev Senior)

## Contexto

El botón **"Pegar (experimental)"** de FedEx en Envíos hoy se muestra con una condición
hardcodeada en el front:

```js
const showPaste =
  (pasteRole === "superadmin" || pasteRole === "superamin") &&
  process.env.NEXT_PUBLIC_EXPERIMENTAL_PASTE === "1"
```

Es decir: **solo superadmin + flag de entorno**. La feature ya funciona en su totalidad y
se quiere poder habilitarla a otras personas/roles para evaluación, **cuando se quiera y sin
redeploy**.

## Objetivo

Pasar el gating del botón al mismo sistema RBAC que todo lo demás (`hasPermission`), de modo
que:

- Por defecto quede habilitado **solo para superadmin** (igual que hoy).
- Se pueda habilitar a otra persona/rol desde **Configuración** (RBAC), sin tocar código.

Precedente idéntico: `monitoreoRutas` (pantalla experimental exclusiva superadmin gateada por
RBAC).

## Decisiones

- **Flag de entorno `NEXT_PUBLIC_EXPERIMENTAL_PASTE`: se elimina.** El acceso lo controla 100%
  RBAC/Configuración, igual que `monitoreoRutas`. Más limpio, consistente y sin redeploy para
  habilitar/deshabilitar.
- **Code del permiso:** `operaciones.pegarFedex`, grupo `Operaciones`, roles por defecto
  `['superadmin']`.

## Cambios

### Backend (`pmy-api`) — espejo de `monitoreoRutas`

1. `src/auth/rbac/permission-catalog.ts`: agregar
   `{ code: 'operaciones.pegarFedex', name: 'Pegar FedEx (experimental)', groupName: 'Operaciones', roles: ['superadmin'] }`.
2. Nueva migración `Sync...PegarFedexPermission` (copia idempotente de
   `1786000000026-SyncMonitoreoRutasPermission`) que da de alta el permiso en la BD y lo asigna
   a los roles del catálogo, para que aparezca en Configuración. `down` elimina el permiso y sus
   `role_permissions`.

### Frontend (`app-pmy`)

3. `app/operaciones/envios/page.tsx`: reemplazar la condición `showPaste` por
   `hasPermission(user, "operaciones.pegarFedex")` (import desde `@/lib/access/permissions`).
   Eliminar el uso de `pasteRole` y del flag `NEXT_PUBLIC_EXPERIMENTAL_PASTE` para este botón.
   Quitar la línea `NEXT_PUBLIC_EXPERIMENTAL_PASTE=1` de `.env.local` (ya no se usa).

## Fuera de alcance

- No se cambia el flujo del pegar en sí (Tarea 1 original), solo el gating de visibilidad.
- No se toca el guardado de archivos de importación ni el borrado con aprobación.

## Verificación

- Backend: correr la migración en dev (`DB_SYNC=false`); confirmar que el permiso aparece en
  `GET /rbac/permissions` bajo grupo Operaciones.
- Frontend: con superadmin, el botón sigue visible; con un rol sin el permiso, no se ve; al
  otorgar el permiso a ese rol/usuario en Configuración, el botón aparece.

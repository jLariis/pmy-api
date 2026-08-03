# Soporte v2 — Kanban + SLA + integración de layout — Diseño

- **Fecha:** 2026-07-31
- **Autor:** Javier (arquitectura asistida)
- **Repos:** `pmy-api` (NestJS/TypeORM) · `app-pmy` (Next.js, shadcn+tailwind)
- **Estado:** Aprobado — implementación inline en rama `feat/support-v2-kanban`
- **Base:** extiende [2026-07-09-notifications-events-and-support-design.md](2026-07-09-notifications-events-and-support-design.md) (no reescribe el módulo)

## 1. Contexto

El módulo de Soporte ya existe (CRUD, comentarios, adjuntos de imagen a disco, folio,
notificaciones bell+correo por catálogo). Faltan mejoras de producto:

- Las 3 páginas del frontend **no** están dentro de `AppLayout` (sin sidebar/header) ni en el sidebar.
- El panel admin es una **lista**, se quiere un **tablero kanban** con backlog.
- Falta **auto-asignación** por defecto, **SLA** con alertas y un **algoritmo de urgencia**.

## 2. Decisiones (brainstorming 2026-07-31)

1. **Columnas kanban:** `Backlog → Por hacer → En progreso → En revisión → Hecho` (+ `Rechazado`).
   Mapea a estados: `pendiente`(Backlog), `por_hacer`, `en_progreso`, `en_revision`,
   `completado`(Hecho), `rechazado`.
2. **Agrupar/ordenar:** barra de botones manual — Urgencia (algoritmo) · Tipo · Sucursal · Antigüedad.
   El superadmin cambia el orden/swimlane en vivo. La urgencia se calcula pero la prioridad
   se puede override manualmente.
3. **Tiempos:** SLA por prioridad con alertas de vencimiento (badge rojo "vencido").
4. **Asignables:** lista configurable (`company-settings`/env), default `admin@delyaqui.com`,
   auto-asignado al crear.
5. **Diseño frontend:** shadcn + tailwind. Drag-and-drop con `@dnd-kit`.

## 3. Backend (`pmy-api/src/support`)

### 3.1 Estados
`estado` es `varchar(20)` → solo se amplían los valores permitidos (sin migración de enum):
`pendiente | por_hacer | en_progreso | en_revision | completado | rechazado`.
`en_revision` y `completado`/`rechazado` marcan `resolvedAt` solo en `completado`/`rechazado`.

### 3.2 Auto-asignación
En `create`, si no hay assignee, se asigna al agente default (`admin@delyaqui.com`).
Se resuelve su `userId` por email (repo `User`) para que reciba bell+correo; si no existe
usuario con ese email, se notifica igual por correo. El ticket cae en `pendiente` (Backlog).

### 3.3 Agentes config-driven
`getSupportAgents()` lee de `company-settings` (clave `support_team`) con fallback a env
`SUPPORT_TEAM_EMAIL` (default `admin@delyaqui.com`). Cada agente: `{ id, nombre, email, phone? }`.
El default siempre está presente. Expuesto por `GET /support/agents`.

### 3.4 SLA
Config por prioridad (company-settings `support_sla_hours`, defaults):
`urgente=4, alta=24, media=72, baja=168` horas.
`slaDueAt = createdAt + horas(prioridad)`; se recalcula al cambiar prioridad.
Se persiste `slaDueAt` (nuevo campo `datetime null`). Estados `completado`/`rechazado` no vencen.

### 3.5 Algoritmo de urgencia (calculado al leer, no persistido)
```
score = pesoPrioridad + pesoTipo + min(horasAntiguedad, 48) + (vencidoSLA ? 80 : 0)
pesoPrioridad: urgente 100 | alta 60 | media 30 | baja 10
pesoTipo:      error 20 | cambio 10 | mejora 5 | eliminar 5
```
Override manual del superadmin = cambiar `prioridad` (ya existe) → recalcula.

### 3.6 Campos calculados en la respuesta
El mapper del service agrega (sin tocar la tabla salvo `slaDueAt`):
`urgencyScore`, `slaBreached` (bool), `ageHours`, `timeInColumnHours` (desde `updatedAt`),
`slaDueAt`, `assigneeEmail`.

### 3.7 Endpoints (sin cambios de forma)
`GET /support/tickets` (+campos calculados y filtro `sucursal`, `asignado`),
`GET /support/tickets/mine`, `GET /support/tickets/:id`,
`PATCH /support/tickets/:id` (estado/prioridad/assigneeId — mover columna = cambiar estado),
`POST /support/tickets/:id/comments`, `GET /support/agents`.

## 4. Notificaciones / correo

- Catálogo ya cablea bell+email en `ticket.creada/asignado/estado/comentario`.
- `ticket.creada`: audiencia = **assignee real** (admin), no `role: superadmin`.
- Nuevo `ticket.sla_vencido` (bell+email al assignee) emitido por **cron diario**
  para tickets abiertos con `slaDueAt < now` no resueltos (evita duplicar con marca `slaNotifiedAt`).

## 5. Frontend (`app-pmy`, shadcn+tailwind)

### 5.1 Layout + navegación
- Envolver `support/tickets`, `support/my-tickets`, `support/admin` en `<AppLayout>` + `OperationHeader`.
- Sidebar: grupo **Soporte** → Nueva solicitud · Mis solicitudes · Tablero (solo admin/superadmin).

### 5.2 Tablero Kanban (`support/admin` → board)
- 6 columnas por estado; **drag-and-drop** (`@dnd-kit`) entre columnas → `PATCH estado`.
- **Barra de agrupar/ordenar** (botones): Urgencia · Tipo · Sucursal · Antigüedad (swimlanes/orden en vivo).
- **Tarjeta:** folio, título, icono de tipo, badge de prioridad, solicitante, sucursal,
  antigüedad, **badge SLA** (rojo "vencido").
- **Filtros:** tipo, prioridad, sucursal, asignado, texto.
- **Métricas** en header: abiertos, vencidos, tiempo promedio de resolución.
- **Detalle (dialog):** reasignar (agentes), estado/prioridad, comentarios (+internas),
  galería de imágenes con **lightbox**, reabrir ticket.

### 5.3 Historial usuario (`my-tickets`)
- Dentro del layout; timeline de estado/comentarios. SLA no se muestra al solicitante.

### 5.4 Adjuntos
- Wizard ya sube imágenes; se pule preview y visor lightbox en detalle.

## 6. Fases (cada una desplegable sola)

1. Layout + navegación (frontend).
2. Backend: estados, auto-asignación, SLA (`slaDueAt`), urgencia, agentes config, campos calculados, tests.
3. Kanban board (`@dnd-kit`, tarjetas, agrupar/ordenar, filtros, detalle, métricas).
4. Historial usuario + adjuntos/lightbox.
5. Mejoras: cron SLA vencido, métricas.

## 7. Criterios de aceptación

- Las 3 páginas se ven dentro del layout, con entrada en el sidebar.
- Un ticket nuevo se auto-asigna a `admin@delyaqui.com`, cae en Backlog, y dispara correo+bell al admin.
- El tablero permite arrastrar entre columnas (persiste estado), agrupar/ordenar por
  urgencia/tipo/sucursal/antigüedad con botones, y muestra badge SLA rojo al vencer.
- El superadmin reasigna a cualquier agente de la lista configurable.
- El solicitante ve su historial dentro del layout con seguimiento de estado/comentarios.
- Ningún fallo de correo/notificación rompe la operación.

## 8. Riesgos

- **Nuevos estados:** DTOs y UI deben aceptar `por_hacer`/`en_revision`; datos viejos siguen válidos.
- **Dependencia `@dnd-kit`:** ligera y accesible; fallback a mover por botones si se descarta.
- **Cron SLA:** best-effort, marca `slaNotifiedAt` para no repetir; jamás rompe operación.

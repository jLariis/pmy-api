# Notificaciones/Eventos de primera clase + Soporte técnico — Diseño

- **Fecha:** 2026-07-09
- **Autor:** Javier (arquitectura asistida)
- **Repos:** `pmy-api` (NestJS/TypeORM) · `app-pmy` (Next.js)
- **Estado:** Aprobado para plan de implementación

## 1. Contexto y motivación

Se quiere terminar la sección de **Soporte técnico** (tickets) ya iniciada en el frontend
(`app/support/*`). Al analizarla surgió una oportunidad mayor: el sistema de
notificaciones actual (la campana) es un **read-model derivado de auditoría** que:

- Genera mensajes ya legibles vía `src/audit/audit-catalog.ts` (`resolveAudit()`), pero
- **no puede dirigir** un aviso a una persona concreta (solo difunde por sucursal o a superadmin),
- **no tipa** los eventos (sin ícono, categoría ni deep-link),
- está **acoplado al HTTP** (solo "notifica" lo que pasa por el interceptor).

Decisión del negocio: **hacerlo todo junto** — construir un subsistema de notificaciones de
primera clase, montar Soporte encima, y **migrar** los eventos existentes a él, sin romper la
campana en producción.

### Estado actual verificado

**Frontend (`app-pmy`)**
- Existen 3 páginas: [crear ticket](../../../../app-pmy/app/support/tickets/page.tsx) (wizard 3 pasos),
  [mis solicitudes](../../../../app-pmy/app/support/my-tickets/page.tsx),
  [panel admin](../../../../app-pmy/app/support/admin/page.tsx).
- Las 3 importan `@/services/support-ticket.service` y `@/types/support-ticket` que **NO existen**
  y con ruta equivocada. Convención real: `lib/services/*.ts` (usan `axiosConfig`) + `lib/types`.
  **Tal como están, no compilan.**
- El panel admin tiene desarrolladores hardcodeados y la asignación solo muta estado local.
- Botón "Agregar envío" en `components/app-layout.tsx:225`.

**Backend (`pmy-api`)**
- No existe módulo de soporte.
- Piezas reutilizables: `EmailService` (nodemailer/Outlook365, `src/auth/email.service.ts`),
  `WhatsappGatewayService.sendText(phone, text)` (`src/whatsapp-gateway/`),
  `NotificationsService` derivado de `AuditLog` (`src/notifications/`),
  `audit-catalog.ts` (redacción legible por evento), `NotificationRead` (watermark `lastReadAt`).

### Decisiones tomadas (brainstorming)

1. **Destinatario/asignable de soporte:** solo Javier por ahora, pero **config-driven** para crecer.
2. **Adjuntos:** en **disco + URL** (patrón de `devolutions/upload`).
3. **Canales de notificación:** correo + campana in-app + WhatsApp.
4. **Alcance:** los 3 specs juntos (infra + soporte + migración).
5. **Modelo de entrega in-app:** **fan-out por destinatario** (1 fila por persona), con
   **audiencia declarada por evento** y job de retención. (Se descartó la marca de agua por
   sucursal porque no permite dirigir ni leído por-ítem.)

## 2. Objetivos y no-objetivos

**Objetivos**
- Subsistema `Notification` de primera clase con API `emit()` reutilizable por cualquier módulo.
- Catálogo de eventos que declara, por tipo: `icon`, `category`, `audience`, `channels`, `link`,
  reutilizando el `describe()` legible que ya existe.
- Entrega multicanal best-effort (campana / correo / WhatsApp) que **nunca** rompe la operación.
- Migración de los eventos operativos actuales al nuevo sistema vía el interceptor de auditoría,
  con **cutover por unión** (sin campana vacía).
- Módulo de Soporte completo (CRUD, asignación, comentarios, adjuntos, seguimiento) montado sobre `emit()`.
- Frontend: capa de datos de soporte corregida, panel admin conectado, botón en el layout,
  campana con íconos/deep-links/leído por-ítem.

**No-objetivos (por ahora)**
- Preferencias de notificación por usuario (silenciar por categoría) — se deja el gancho, no la UI.
- Equipo de soporte multi-agente con roles/SLA avanzados — la base queda lista, sin UI dedicada.
- Push del navegador / app móvil.
- Almacenamiento de adjuntos en S3 (se usa disco).

## 3. Arquitectura del subsistema de notificaciones

### 3.1 Entidad `Notification` (fan-out por destinatario)

`src/entities/notification.entity.ts`

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `recipientId` | uuid (idx) | usuario destinatario (una fila por persona) |
| `type` | varchar (idx) | p.ej. `salida_ruta.creada`, `ticket.asignado` |
| `category` | enum | `operacion` \| `soporte` \| `sesion` \| `sistema` |
| `title` | varchar | encabezado corto |
| `body` | text | texto legible (del `describe()` del catálogo) |
| `icon` | varchar | nombre de ícono (mapea a lucide en el front) |
| `severity` | enum | `info` \| `success` \| `warning` \| `error` |
| `link` | varchar null | deep-link relativo (`/support/admin?ticket=…`) |
| `entityId` | varchar null | id del registro relacionado |
| `subsidiaryId` | uuid null | sucursal de origen (filtros) |
| `actorId` | uuid null | quién originó el evento |
| `actorName` | varchar null | denormalizado para lectura barata |
| `read` | boolean (idx) | default false |
| `readAt` | timestamptz null | |
| `createdAt` | timestamptz (idx) | |

Índices: `(recipientId, read)`, `(recipientId, createdAt)`. Retención: job que borra
`read = true AND createdAt < now() - 90d` (configurable `NOTIFICATIONS_RETENTION_DAYS`).

`NotificationRead` (watermark) se conserva **solo** mientras exista el feed legado; se elimina al
completar el cutover.

### 3.2 `NotificationsService.emit(event)`

```ts
interface NotificationEvent {
  type: string;                       // clave del catálogo
  audience: Audience;                 // a quién
  title?: string; body?: string;      // override; si no, los toma el catálogo
  icon?: string; severity?: Severity;
  link?: string; entityId?: string;
  subsidiaryId?: string;
  actor?: { id?: string; name?: string };
  channels?: Channel[];               // override; si no, del catálogo
  data?: Record<string, any>;         // contexto para plantillas (correo/wa)
}

type Audience =
  | { userId: string }                      // dirigido
  | { userIds: string[] }
  | { subsidiaryId: string; roles?: string[] }  // difusión acotada
  | { role: string }                        // p.ej. todos los superadmin
  | { global: true };
```

Flujo de `emit()`:
1. **Resolver audiencia** → lista de `recipientId` (consulta a `users` por sucursal/rol; se
   excluye al `actor` para no auto-notificarse en difusión).
2. **Resolver presentación** (title/body/icon/severity/link/channels) desde el catálogo si no vienen.
3. **Fan-out**: inserta N filas `Notification` (bulk insert).
4. **Despacho de canales** best-effort, en paralelo, cada uno en `try/catch` + `logger.warn`:
   - `bell`: implícito (ya se persistió la fila).
   - `email`: `EmailService` con plantilla HTML branded.
   - `whatsapp`: `WhatsappGatewayService.sendText()` a los teléfonos de los destinatarios/equipo.
5. **Nunca** propaga excepción al llamador (una notificación fallida no rompe la operación).

`emit()` es **async fire-and-forget** desde el interceptor (no se espera con `await` en el flujo
crítico); en servicios de dominio se puede `await` o no según el caso.

### 3.3 Catálogo de eventos (evoluciona `audit-catalog.ts`)

Nuevo `src/notifications/notification-catalog.ts`: por cada `type`, declara metadatos de
presentación y entrega. Reutiliza la lógica de `describe()` del catálogo de auditoría para el texto.

```ts
interface NotificationTypeDef {
  category: Category;
  icon: string;
  severity?: Severity;
  defaultChannels: Channel[];
  resolveAudience?: (ctx) => Audience;   // p.ej. supervisores de la sucursal
  buildLink?: (ctx) => string | undefined;
}
```

El **puente auditoría→notificación**: un mapeo `AuditModule/acción → notification.type`. Como el
interceptor ya calcula `resolveAudit()` (módulo, acción, descripción rica), solo se traduce ese
resultado a un `NotificationEvent` y se llama `emit()`.

### 3.4 Integración con el interceptor (migración)

En `AuditInterceptor`, tras `this.audit.log(...)` en el `tap` de éxito de mutaciones:

```ts
this.notifications.emitFromAudit({
  module: e.module, action: e.action,
  title: e.entityName, body: e.description,
  entityId, subsidiaryId, actor: {...},
  path: normPath, response,
});
```

- `emitFromAudit()` busca el `type` correspondiente en el puente; si no hay mapeo específico, usa
  un default operativo (`category: operacion`, ícono genérico, audiencia = supervisores de la
  sucursal, canal = solo campana). Así **todo lo auditado notifica desde el día uno**, y la
  migración consiste en **enriquecer** eventos concretos (mejor ícono, deep-link, audiencia/canales).
- Best-effort: envuelto en try/catch; jamás afecta la respuesta.
- Sesiones (login/logout) → `category: sesion`, audiencia = superadmins (igual que hoy).

### 3.5 Feed y cutover

`NotificationsService.getFeed(user, limit)`:
- **Fase de transición:** une (a) filas `Notification` del usuario + (b) items derivados de
  auditoría legados (código actual), ordena por `createdAt` desc, dedup por `entityId+type`.
- **Post-cutover:** solo lee de `Notification`. Se elimina la derivación legada y `NotificationRead`.

Endpoints (`notifications.controller.ts`):
- `GET /notifications?limit=` → feed + `unreadCount`.
- `POST /notifications/mark-read` → marca todo leído (compat).
- `POST /notifications/:id/read` → **nuevo**, leído por-ítem.

## 4. Módulo de Soporte (`src/support/`)

### 4.1 Entidades

**`SupportTicket`** — `id`, `folio` (`SUP-0001`, secuencial legible), `tipo`
(`mejora|cambio|eliminar|error`), `titulo`, `descripcion`, `estado`
(`pendiente|en_progreso|completado|rechazado`), `prioridad` (`baja|media|alta|urgente`),
ubicación (`menuPrincipal`, `submenu`, `seccion`, `subseccion`, `nuevoMenu`, `menuError`,
`submenuError`, `pasosReplicar`), `requesterId/Name/Email`, `subsidiaryId`,
`assigneeId/Name` (null), **contexto auto-capturado** (`appVersion`, `route`, `userAgent`,
`device` — desde headers de `client-meta`), `createdAt`, `updatedAt`, `resolvedAt` (null).

**`SupportTicketComment`** — `id`, `ticketId`, `authorId/Name`, `texto`, `internal` (bool:
nota interna vs. visible al solicitante), `createdAt`.

**`SupportTicketAttachment`** — `id`, `ticketId`, `filename`, `url`, `mime`, `size`, `createdAt`.

### 4.2 Endpoints (`/support`)

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/support/tickets` | crear (multipart: campos + `imagenes[]`) |
| GET | `/support/tickets` | admin; filtros `estado/tipo/prioridad/q/asignado` |
| GET | `/support/tickets/mine` | del solicitante autenticado |
| GET | `/support/tickets/:id` | detalle (con comentarios + adjuntos) |
| PATCH | `/support/tickets/:id` | estado / prioridad / `assigneeId` |
| POST | `/support/tickets/:id/comments` | agregar comentario (`internal?`) |
| GET | `/support/agents` | asignables/destinatarios (config-driven; hoy = Javier) |
| (static) | `/uploads/support/*` | servir adjuntos |

- **Adjuntos:** `FilesInterceptor` (Multer) a `uploads/support/<ticketId>/`, servido estático.
  Validación: solo imágenes, límite de tamaño/cantidad. Se registra `url` relativa.
- **Folio:** secuencia (`SUP-` + contador); generar en el service dentro de transacción.
- **Config de agentes/destinatarios:** `SUPPORT_TEAM` (env o tabla `company-settings`), default
  `javier.lopez@derevo.com.mx` + teléfono WA. `getSupportAgents()` lo expone al front.

### 4.3 Notificaciones de soporte (matriz declarativa)

Cada transición llama `emit()`:

| Evento | type | Solicitante | Equipo/Asignado |
|---|---|---|---|
| Ticket creado | `ticket.creada` | campana (confirmación) | correo + campana + WhatsApp |
| Asignado | `ticket.asignado` | campana | correo + campana (al asignado) |
| Cambio de estado (resuelto/rechazado) | `ticket.estado` | correo + campana | — |
| Nuevo comentario (agente) | `ticket.comentario` | correo + campana | — |
| Nuevo comentario (solicitante) | `ticket.comentario` | — | campana |
| Prioridad urgente | `ticket.urgente` | — | WhatsApp |

WhatsApp se reserva a *nuevo* y *urgente* para no saturar. Todo configurable en el catálogo.

## 5. Frontend (`app-pmy`)

- **`lib/types/support-ticket.ts`** — tipos + constantes (`TIPO_TICKET_INFO`, `MENUS_INFO`,
  `SECCIONES_CONFIG`, helpers de color/label) que la UI ya consume.
- **`lib/services/support-ticket.service.ts`** — con `axiosConfig`:
  `getAllTickets`, `getMyTickets`, `getTicket`, `createTicket(data, imagenes)`,
  `updateTicket(id, patch)`, `addComment({ticketId, texto, internal?})`, `getSupportAgents`.
- **Corregir imports** en las 3 páginas (`@/services/...`→`@/lib/services/...`,
  `@/types/...`→`@/lib/types/...`).
- **Panel admin:** cargar agentes reales (`getSupportAgents`); conectar el `<Select>` de asignación
  al backend (hoy solo muta estado local); usar folio.
- **Botón de Soporte** en `components/app-layout.tsx`, justo después de "Agregar envío"
  (línea ~225), con tooltip → navega a `/support/tickets`.
- **Campana:** el item del feed gana `icon` (mapa a lucide), `link` (navegación al hacer clic) y
  **leído por-ítem** (`POST /notifications/:id/read`). Shape compatible con el actual.

## 6. Plan de implementación por fases

1. **Infra de notificaciones (cimiento):** entidad `Notification`, `NotificationsService.emit()`,
   audience resolver, canales (bell/email/whatsapp), catálogo base, endpoint leído por-ítem,
   job de retención. Feed en modo **unión** (legado intacto).
2. **Puente auditoría→notificación:** `emitFromAudit()` en el interceptor con default operativo.
   Verificar que la campana sigue llena y sin duplicados.
3. **Módulo de Soporte (backend):** entidades, endpoints, adjuntos, folio, agentes config-driven,
   `emit()` en cada transición.
4. **Frontend de Soporte:** capa de datos (`lib/services` + `lib/types`), corrección de imports,
   panel admin conectado, botón en el layout.
5. **Campana enriquecida (frontend):** íconos, deep-links, leído por-ítem.
6. **Migración/enriquecimiento de eventos:** por módulo (salidas a ruta, desembarques,
   consolidados, devoluciones, etc.), afinar ícono/audiencia/link/canales en el catálogo.
7. **Cutover:** cuando el catálogo cubre los tipos vivos, apagar la derivación legada y retirar
   `NotificationRead`.

## 7. Riesgos y mitigaciones

- **Ruido/volumen (fan-out):** audiencia acotada por evento (operaciones → supervisores, no todos) +
  retención 90 días + índices. Revisar conteos tras la Fase 2.
- **Romper operaciones por una notificación:** todo `emit()`/canal es best-effort con try/catch y log;
  fire-and-forget desde el interceptor.
- **Duplicados durante la unión:** dedup por `entityId+type` en el feed de transición.
- **WhatsApp no conectado:** `sendText` lanza `ServiceUnavailableException`; se captura y degrada
  (la campana/correo igual salen).
- **Migraciones TypeORM:** entidades nuevas requieren migración; seguir el patrón del repo
  (ver commits recientes de expenses). Adjuntos en disco requieren carpeta servida y en `.gitignore`.

## 8. Criterios de aceptación

- Crear un ticket desde el wizard genera el registro, sube imágenes, y dispara correo al equipo +
  campana + WhatsApp (si urgente/nuevo), con folio legible.
- El solicitante ve en su campana (con ícono y link) cuando su ticket cambia de estado o recibe
  comentario del agente.
- El panel admin lista, filtra, asigna (persistido), comenta y cambia estado/prioridad reales.
- La campana existente sigue mostrando la actividad operativa (sin regresiones) y ahora con
  íconos/links y leído por-ítem.
- Ningún fallo de correo/WhatsApp/notificación rompe la operación que lo originó.

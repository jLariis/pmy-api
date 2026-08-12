# Soporte v3 — Generador de prompt IA + endurecimiento SLA/notificaciones — Diseño

- **Fecha:** 2026-08-11
- **Autor:** Javier (arquitectura asistida)
- **Repos:** `pmy-api` (NestJS/TypeORM) · `app-pmy` (Next.js, shadcn+tailwind)
- **Estado:** Aprobado — implementación inline
- **Base:** extiende [2026-07-31-soporte-v2-kanban-sla-design.md](2026-07-31-soporte-v2-kanban-sla-design.md) y
  [2026-07-09-notifications-events-and-support-design.md](2026-07-09-notifications-events-and-support-design.md)

## 1. Contexto

El módulo de Soporte ya tiene tablero kanban, SLA por prioridad, urgencia, agentes config-driven,
notificaciones bell/email/whatsapp y cron de SLA vencido. Este spec agrega la pieza pedida
(convertir la descripción del usuario en un **prompt para IA** con nombres reales de archivo/componente)
y endurece SLA y notificaciones a partir de una revisión senior.

## 2. Decisiones (brainstorming 2026-08-11)

1. **Motor del prompt:** determinista + grafo graphify. **Cero costo de API**, reproducible.
2. **Entrega:** botón on-demand en el detalle del ticket (tablero admin), superadmin-only. No se persiste
   (persistir/editar queda como follow-up).
3. **Mejoras en alcance:** (#1) prioridad inicial por tipo, (#3) aviso preventivo SLA 80%,
   (#4/#5) arreglo de canales/WhatsApp, (#2) SLA en horario hábil + primera respuesta.

## 3. Hallazgos de la revisión (que este spec corrige)

1. Todo ticket nace `prioridad='media'` hardcodeado → SLA 72h aunque sea `error`. (`support.service.ts:61`)
2. SLA es 24/7 (cuenta fin de semana/noche); sin SLA de primera respuesta. (`support-logic.ts`)
3. Solo se avisa cuando el SLA **ya venció**; no hay aviso preventivo. (`support-sla.cron.ts`)
4. WhatsApp siempre va a `process.env.SUPPORT_WHATSAPP`, ignora `agent.phone`. (`notification-dispatch.service.ts:47`)
5. `ticket.urgente` → solo whatsapp (sin registro en campana); `sla_vencido` (error) → sin whatsapp. (`notification-catalog.ts`)

## 4. A — Generador de prompt (núcleo, superadmin-only, sin API)

### 4.1 Flujo
Dialog de detalle (tablero admin) → botón **"Generar prompt IA"** → `GET /support/tickets/:id/prompt`
(`JwtAuthGuard` + `SuperAdminGuard`) → panel con el prompt + botón copiar.

### 4.2 Piezas nuevas en `pmy-api/src/support/`

- **`prompt-builder.ts`** (lógica pura, sin Nest, testeable). Recibe `{ ticket, codeContext }` y ensambla
  secciones: Objetivo (verbo por `tipo`: mejora→implementar, cambio→modificar, eliminar→quitar, error→corregir bug),
  Descripción del usuario, Pasos para reproducir, Ubicación (menú/sección/route/appVersion),
  Contexto de código (repo + archivos/componentes candidatos + etiqueta de confianza),
  Criterios de aceptación (derivados del `tipo`), Adjuntos (n imágenes con URLs).

- **`code-locator.service.ts`** — carga `graph.json` (cacheado con `mtime`) de rutas configurables
  `SUPPORT_GRAPH_PATHS` (default dev: `../app-pmy/graphify-out/graph.json`). Dado `{ route, menuPrincipal,
  submenu, seccion, subseccion }`:
  - *Seed:* nodos cuyo `source_file` casa con segmentos de `route` (Next app-router → `app/<route>/page.tsx`)
    o contiene el keyword de submenu/sección.
  - *Expansión:* un salto por `links` para traer los `components/...` importados.
  - *Ranking:* especificidad de ruta + coincidencia de keyword → top-N archivos y componentes.
  - **Degradación:** sin grafo accesible → solo texto de ubicación. Nunca lanza.
  - Forma de nodo (verificada): `{ id, label, source_file, source_location, community, ... }`; `links` en `graph.links`.

- **Endpoint** `GET /support/tickets/:id/prompt` con `@UseGuards(JwtAuthGuard, SuperAdminGuard)`.
  Responde `{ prompt, context: { repo, files[], components[], confidence } }`. On-demand, no persiste.

## 5. B — Prioridad inicial por tipo (#1)
Mapa `tipo→prioridad` en `support-config.ts`: `error→alta` (24h), `cambio→media`, `mejora/eliminar→baja`.
Configurable por env `SUPPORT_INITIAL_PRIORITY`. `create()` usa el mapa y calcula `slaDueAt` acorde. Tests.

## 6. C — Aviso preventivo SLA 80% (#3)
Nuevo campo `slaWarnedAt datetime null`. El cron (mismo barrido horario) marca tickets abiertos con
`now ≥ createdAt + 0.8·SLA` y `slaWarnedAt IS NULL` → emite `ticket.sla_por_vencer` (bell+email al asignado),
sella `slaWarnedAt`. Nuevo tipo en catálogo, severity `warning`.

## 7. D — Canales / WhatsApp (#4, #5)
- `deliver()` usa el `phone` real del destinatario (agente) con fallback a `SUPPORT_WHATSAPP`.
- Catálogo: `ticket.urgente` → `['bell','email','whatsapp']`; `ticket.sla_vencido` → agregar `whatsapp`.

## 8. E — SLA en horario hábil + primera respuesta (#2)
- `addBusinessHours()` puro en `business-hours.ts` (luxon, TZ-aware): cuenta solo horas hábiles.
  Config **L–V 9:00–18:00, America/Mexico_City** (decisión 2026-08-11), override por env
  `SUPPORT_BUSINESS_TZ/START/END/DAYS`. Feature-flag `SUPPORT_SLA_BUSINESS_HOURS=false` vuelve a 24/7.
- Resolución de fechas en `support-config.ts`: `slaDueAtFor` / `slaWarnAtFor` / `firstResponseDueAtFor`
  eligen horario hábil o 24/7 según el flag. El service usa estos helpers (no `computeSlaDueAt` directo).
- SLA de **primera respuesta:** `firstResponseDueAt` + `firstRespondedAt` (se sella con el primer comentario
  del agente o el primer paso a `en_progreso`/`en_revision`) + `firstResponseNotifiedAt`. Umbral propio
  `SUPPORT_FIRST_RESPONSE_HOURS` (defaults urgente=1, alta=4, media=8, baja=24). Barrido `sweepFirstResponse`
  en el cron → `ticket.primera_respuesta_vencida` (bell+email).
- Suite de tests de borde (fin de semana, cruce de día, antes de abrir/después de cerrar): 9 casos verdes.

## 8bis. F — Motor IA opcional (DeepSeek)

Segunda alternativa de generación además del determinista, on-demand y superadmin-only.
- Módulo reutilizable `src/ai` (`AiModule` + `DeepseekService`, API compatible con OpenAI, modelo
  `deepseek-chat`). **Solo capa gratuita**: ante HTTP 429 espera con backoff honrando `Retry-After`
  hasta `DEEPSEEK_MAX_WAIT_MS` (default 5 min); no reintenta 401/402/403 (credenciales/saldo).
- La IA **mejora el prompt determinista** (`support/ai-prompt.ts`): meta-prompt que exige conservar
  archivos/componentes reales del grafo (no alucinar rutas) y devolver solo el prompt final.
- Endpoint `GET /support/tickets/:id/prompt?engine=ia` (default `deterministico`). Si la IA no está
  configurada o falla → **fallback al determinista con `warning`**; nunca rompe.
- Env: `DEEPSEEK_API_KEY` (habilita), `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL`, `DEEPSEEK_MAX_RETRIES`,
  `DEEPSEEK_MAX_WAIT_MS`, `DEEPSEEK_TIMEOUT_MS`.
- Frontend: dos botones ("Generar (grafo)" / "Generar con IA") + badge de motor + aviso de fallback.

## 9. Fases (cada una desplegable sola)
1. Generador de prompt (locator + builder + endpoint + botón UI). **El pedido central.**
2. Prioridad inicial por tipo (#1).
3. Canales/WhatsApp (#4, #5).
4. Aviso preventivo 80% (#3).
5. SLA horario hábil + primera respuesta (#2) — el más delicado, al final.

## 10. Aislamiento y compatibilidad
Lógica pura (builder, calendario) separada del I/O (locator lee disco, service orquesta, cron dispara).
Sin migración de enum; solo columnas nuevas nullable (`slaWarnedAt`, `firstResponseDueAt`, `firstRespondedAt`).
Datos viejos siguen válidos.

## 11. Riesgos
- Grafo desactualizado/ausente en prod → confianza etiquetada + degradación a solo-ubicación.
- Calendario laboral mal calculado → suite de tests de borde + feature-flag 24/7.
- Ruta app-pmy no montada en el server de la API → `SUPPORT_GRAPH_PATHS` configurable; si falta, degrada.

## 12. Criterios de aceptación
- El superadmin abre un ticket, presiona "Generar prompt IA" y obtiene un prompt con objetivo, descripción,
  pasos, ubicación y **archivos/componentes reales** del grafo, copiable.
- Un ticket `error` nace con prioridad `alta` (SLA 24h).
- El asignado recibe aviso al 80% del SLA y al vencer; `urgente` llega a campana+email+whatsapp.
- WhatsApp usa el teléfono del agente destinatario.
- El SLA cuenta solo horario hábil y existe SLA de primera respuesta.
- Ningún fallo de grafo/correo/notificación rompe la operación.

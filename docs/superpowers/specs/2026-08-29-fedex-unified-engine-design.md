# Motor unificado de estatus/cobros FedEx por eventos — Diseño (roadmap)

**Fecha:** 2026-08-29
**Estado:** Diseño aprobado; se implementa por fases (cada fase = su propio plan).
**Repo:** `pmy-api`

## 1. Problema

El enriquecimiento FedEx vive en `processMasterFedexUpdate` / `processChargeFedexUpdate` (`shipments.service.ts`), disparado por `@Cron(EVERY_HOUR)` (`tracking.cron.service.ts:45`). Revisión a fondo encontró 8 defectos (correctitud e inconsistencias):

1. **Dos definiciones de "semana"** para el dedup de ingresos (llamador `:8647` vs `generateIncomes :3094`) → cobros duplicados/perdidos en el borde de semana.
2. **Charge ignora la config por sucursal de BD** (`:9026`); master sí la lee (`:8473`) → OD/estatus inconsistente entre envío y carga.
3. **Huella de dedup solo `timestamp_exceptionCode`** (`:8517/:9067`) → colisión y pérdida silenciosa de eventos/estatus distintos al mismo tiempo.
4. **Mismatch de key en el prefetch** (`:8402`) → fallback masivo a `trackPackage` por guía (lento + 429); el propio código lo advierte (`:8891`).
5. **`getShipmentsToValidate` sin LIMIT** + re-poll horario de todo lo PENDIENTE (`:3997`) → carga que crece con el volumen (relevante para import-jobs).
6. **Precedencia por timestamp de escritura** (TODO `:8345`) → un EN_RUTA interno puede ganarle a un evento FedEx real anterior del mismo día.
7. **Charge no refleja el DEX resuelto pre-registro** que master sí (`:8776`).
8. **Selector de generación desempata con `scanEvents[0]` sin ordenar** (`:8433`).

## 2. Objetivo

Hacer el pipeline **inteligente, profesional y confiable**: estatus e ingresos **siempre correctos**, con información real de FedEx **fresca donde importa**, y cobros **garantizados y auditables**. Sin romper lo que hoy funciona (todo por fases, detrás de bandera, con validación en shadow).

## 3. Decisiones (tomadas)

1. **Motor unificado por eventos.** Adoptar el motor `tracking-sync` ya existente como **única fuente de verdad** de estatus (y, nuevo, de cobros); el cron horario, import-jobs, cierre de ruta y el refresco on-demand pasan a usarlo.
2. **Frescura = on-demand + cadencia adaptativa** (sigue siendo pull, sin infra nueva).
3. **Idempotencia de cobro anclada al evento terminal de FedEx** (columna nueva en `Income`), no por semana → garantía fuerte y reconciliación exacta evento↔ingreso.

## 4. Fundamento existente (reutilizado, no reinventado)

El módulo `src/tracking-sync/` ya implementa el motor y **corre en SHADOW** cada hora al :15 (`tracking-sync.cron.ts`), observando el mismo universo sin aplicar:

- `sources/fedex-tracking.source.ts` — trae FedEx (batch).
- `tracking-normalizer.ts` + `event-key.util.ts` — normaliza scanEvents a **eventos canónicos** con **llave idempotente robusta** (resuelve #3, #8).
- `existing-event-loader.ts` + `event-reconciler.ts` — reconcilia por **evento real (occurredAt)**, no por timestamp de escritura (resuelve #6).
- `sync-rules.pipeline.ts` + `rules/` — reglas enchufables: `terminal-lock`, `external-delivery`, `income` (hoy **no-op**, `enabled=false`), `notification`.
- `sinks/persistent-sync.sink.ts` (`applyPlan`, transaccional) y `sinks/shadow-sync.sink.ts` (observa sin aplicar).
- `tracking-compare.service.ts` — `applyMany(shipmentIds, actor)` (ya cubre **envíos y cargas** vía `kind`) y `applyByRoute(...)` (ya lo usa el cierre de ruta).
- `SyncContext` ya expone `proposedStatus` y `deferredEffects: DeferredEffect[]` — plomería lista para el efecto financiero.

**Hueco crítico:** la `IncomeRule` está apagada → el motor deriva **solo estatus**. Cortar el cron al motor sin implementarla **apagaría los cobros**. Por eso los cobros son una fase propia validada en shadow antes de activarse.

## 5. Arquitectura destino

```
FedEx (batch) → Normalizer → EventKey(idempotente) → EventReconciler(occurredAt)
   → RulesPipeline [terminal-lock, external-delivery, income, notification, pre-reg]
   → SyncContext { proposedStatus, deferredEffects:[{type:'income', eventKey, ...}] }
   → Sink (shadow | persistent, transaccional)
        ├─ estatus + historial (idempotente por eventKey)
        └─ DeferredEffect income → IncomeExecutor (ancla al eventKey terminal)
```

Puntos de entrada unificados:
- **Cron adaptativo** (reemplaza el legacy): selecciona el universo por prioridad y llama al motor.
- **On-demand**: `applyMany([shipmentId])` en momentos clave (marcar entregado, ver guía, abrir cierre —ya—).
- **import-jobs**: primer sync inmediato de los PENDIENTE recién insertados vía `applyMany`.

## 6. Piezas nuevas

- **`IncomeRule` (activa) + `IncomeExecutor`.** La regla encola `DeferredEffect{type:'income', eventKey, incomeType, occurredAt, chargeReason}`; el executor lo materializa en una transacción tras aplicar el plan. Reglas cobrables: DL→ENTREGADO, 07/RECHAZADO, 3ª visita (08 acumulado), con el mismo mapeo actual pero derivado del ledger.
- **Ancla de cobro en `Income`.** Columna nueva `sourceEventKey varchar(120) null` (+ índice único `(trackingNumber, incomeType, sourceEventKey)`), por **migración**. La idempotencia deja de depender de la ventana de semana.
- **Util único de semana** (para reportes/compatibilidad), una sola definición lunes–domingo, compartido FE/BE si aplica. Elimina #1/#5.
- **Charge lee config por sucursal de BD** dentro del motor (mismo criterio que master) → elimina #2. El motor ya es agnóstico a `kind`, así que la config viaja por `SyncContext`.
- **Reconciliador de cobros.** Job que verifica: cada evento terminal ↔ exactamente un `Income` correcto y viceversa; emite reporte de discrepancias (y en shadow, sin escribir).
- **Scheduler adaptativo.** Niveles de cadencia por estado/urgencia (calientes: EN_RUTA/OD/DEX-hoy más seguido; frías menos; terminales nunca), con `LIMIT`/backpressure y respeto de cuota FedEx (elimina #4/#5). Métrica de **hit-rate del prefetch**.
- **Observabilidad/SLA.** Métricas: divergencia shadow vs legacy, antigüedad de frescura por guía, duración de corrida, dead-letter, discrepancias de cobro; alertas fuera de SLA.

## 7. Plan por fases (cada una = su propio plan de implementación)

- **F1 — Paridad de estatus + observabilidad.** Comparar shadow vs legacy N días; métricas de divergencia y hit-rate; corregir reglas hasta paridad ≥ legacy. Sin cambios de escritura.
- **F2 — Cobros en shadow (regla financiera + reconciliador).** Implementar `IncomeRule`/`IncomeExecutor` y el ancla (migración), corriendo en **shadow**: calcular "ingreso que se generaría" y reconciliar contra los reales → reporte. Validar cobros **antes** de activar.
- **F3 — Cutover de estatus** (bandera por sucursal, reversible). Motor persistente para estatus; legacy como fallback.
- **F4 — Cutover de cobros.** Activar `IncomeRule` persistente; retirar `generateIncomes` del cron. Reconciliador queda como guardia permanente.
- **F5 — Frescura on-demand + cadencia adaptativa.** Scheduler por prioridad + refresco inmediato en momentos clave + primer sync de import-jobs.
- **F6 — Reconciliación + SLA permanentes.** Job diario + alertas.

**Orden de valor:** F1 y F2 entregan correctitud/garantía de cobros sin riesgo (shadow); F3/F4 hacen el cambio real gradual; F5/F6 dan frescura y garantía continua.

## 8. Coexistencia y seguridad

- Legacy (`processMasterFedexUpdate`/`processChargeFedexUpdate`/`generateIncomes`) **intacto** hasta que cada fase pruebe paridad; queda como fallback tras el cutover.
- Todo detrás de **bandera** (global y por sucursal); reversible al instante.
- Esquema por **migración** (`synchronize:false`). Reglas/executors/scheduler son **piezas nuevas**.
- El motor ya tiene tests (specs en `tracking-sync/`); cada fase agrega los suyos (paridad, idempotencia de cobro por eventKey, reconciliación, cadencia).

## 9. Cómo cierra cada hallazgo

| # | Hallazgo | Fase/pieza |
|---|---|---|
| 1,5 | Ventana de semana / dedup de cobro | F2: ancla por evento + util único |
| 2 | Charge ignora config BD | F1/F3: config vía SyncContext en el motor |
| 3 | Dedup débil `t_ecode` | Fundamento: event-key robusto |
| 4 | Key del prefetch | F5: métrica hit-rate + normalizador del motor |
| 5 | Sin LIMIT / re-poll total | F5: scheduler adaptativo + backpressure |
| 6 | Precedencia por timestamp | Fundamento: EventReconciler por occurredAt |
| 7 | Charge sin pre-reg resuelto | F1: regla pre-registro en el pipeline (aplica a ambos kinds) |
| 8 | Selector de generación sin orden | Fundamento: normalizador ordena por occurredAt |

## 10. Fuera de alcance

- Push/webhook FedEx casi-real (se evaluó; no en este roadmap — pull on-demand + cadencia cubre el objetivo sin infra/costo extra).
- Cambios de UI (paneles de monitoreo del motor ya existen en `tracking-sync`/experimental).

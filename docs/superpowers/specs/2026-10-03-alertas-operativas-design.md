# Fase 4 — Seguimiento de consolidados + alertas operativas

Fecha: 2026-10-03 · Rama: `feat/bandeja-correo-fedex` (pmy-api y app-pmy). Base: spec 2026-10-01 (bandeja).

## Objetivo

Para cada consolidado que llegó por correo, seguir su recorrido en la operación y avisar a tiempo
cuando un paso no se hace dentro de su plazo, escalando si sigue sin hacerse. Todo configurable en
Configuración.

## Recorrido (calculado en vivo, sin cambiar la operación)

`Llegó (receivedAt) → Subido (uploadedAt) → Desembarcado → En ruta → Ruta cerrada`

- Guías del consolidado: master/aéreo → `consolidated.consNumber` → `shipment.consolidatedId`;
  F2 → `charge.consNumber` → `charge_shipment.chargeId`.
- Desembarcado = guías con `unloadingId`; En ruta = guías con fila en `package_dispatch_history`;
  Ruta cerrada = guías cuya salida tiene `route_closure`. Cada paso: guías hechas / total, primera y
  última hora, quién (createdBy del registro).
- Un paso está **completo** cuando el % de guías ≥ `completePct` (default 100).
- Inventario = revisión **diaria por sucursal** (¿hay `inventory` con `inventoryDate` de hoy?).

## Plazos (globales, hora de Hermosillo)

| Paso | Vence | Se evalúa cuando |
|---|---|---|
| Subir | `receivedAt + uploadMinutes` (30) | siempre |
| Desembarque | día del ancla a `unloadingTime` (21:00); si el ancla es posterior, ancla + 2 h | subido (o paso subir apagado) |
| Salida a ruta | día siguiente al ancla a `dispatchTime` (10:00) | desembarcado (o paso apagado) |
| Cierre | día de la primera salida a `closureTime` (21:00) | en ruta |
| Inventario | cada día a `inventoryTime` (19:00) | diario por sucursal |

Ancla = hora en que se cumplió el paso anterior habilitado (o `receivedAt`). Solo consolidados
recibidos en los últimos `lookbackDays` (3).

## Alertas

Tabla `ops_alert` (una por paso y consolidado/día): `level` 0–3, `dueAt`, `notifiedAt`, `resolvedAt`,
`lateMinutes`. Revisor cada 5 min (solo dentro de `activeFrom`–`activeTo`, 06:00–21:30):

- Nivel 1 al vencer → usuarios de la sucursal (principal + adicionales) por campana.
- Nivel 2 a `+escalate1Min` (30) → + encargados (configurados) por campana + correo.
- Nivel 3 a `+escalate2Min` (60) → + superadmin por campana; WhatsApp a números/grupos de la sucursal.
- Si el revisor salta niveles (servidor dormido) solo envía el nivel vigente, una vez.
- Al cumplirse el paso: `resolvedAt`, `lateMinutes`; sin más avisos.

## Configuración

- `ops_alert_settings` (1 fila): `enabled`, plazos, escalamientos, `completePct`, `lookbackDays`,
  `activeFrom`/`activeTo`.
- `ops_alert_subsidiary` (por sucursal): pasos aplicables (`upload`, `unloading`, `dispatch`,
  `closure`, `inventory`), `managerUserIds` (json), `whatsappNumbers` (json), `whatsappGroups`
  (json `[{id, name}]`).
- WhatsApp: cambiar el número que envía = panel actual (desvincular → QR). Nuevo: endpoint de grupos
  del número vinculado para elegirlos.
- UI: Configuración → sección **Alertas operativas** (global + tabla por sucursal), solo superadmin.

## Pantallas de operación

- Bandeja → pestaña **Seguimiento** (antes "Recibido vs subido"): por día y sucursal, cada
  consolidado con su recorrido (pasos con avance y hora) y sus alertas abiertas.
- Panel del correo: en cada bloque subido, el recorrido de ese consolidado.

## Migración

`1786000000090-CreateOpsAlerts` (3 tablas + fila de settings por defecto, `enabled=false`).

## Pruebas

Jest de la parte pura: cálculo de vencimientos por paso (cruce de día, pasos apagados, ancla),
nivel de escalamiento por minutos transcurridos y horario activo, y estado de paso por porcentaje.

## Fuera de alcance

Subida automática (fase 5b) y pantalla de tareas por usuario (fase 6, se apoya en este recorrido).

# Sync FedEx por rutas del día + cadencia 15 min + cobro sin doble — Diseño

**Fecha:** 2026-08-30
**Rama:** `feat/fedex-sync-by-routes` (pmy-api)
**Estado:** Aprobado para implementación (inline).

## 1. Problema / objetivo

Con el cutover encendido (motor por eventos escribiendo estatus+cobros), el sync horario revisa **todo lo pendiente de 6 meses** (miles de guías) y, peor, puede **cobrar doble** con el cierre de ruta. Queremos:

- Revisar **solo las rutas del día** (guías activas) → mucho menos volumen y cuota FedEx.
- Bajar la cadencia a **cada 15 min** en **horario hábil (07:00–22:00 Hermosillo)**.
- Garantizar **un solo ingreso por guía/semana** (sin doble con cierre de ruta/legacy), con **precedencia ENTREGADO**.
- Manejar bien **eventos FedEx anteriores a la captura tardía de la ruta** en sucursales bodega-FedEx (Hermosillo).
- Sin perder cobros de resoluciones fuera de ruta → **barrida diaria** de respaldo.

Todo detrás del flag `TRACKING_SYNC_CUTOVER` (default OFF); el legacy queda intacto como fallback.

## 2. Decisiones (tomadas)

1. **Sync frecuente = rutas del día + no-terminal.**
2. **Cadencia 15 min, 07:00–22:00 Hermosillo** (configurable por env).
3. **Cobro:** un ingreso por `(trackingNumber, semana)`; **ENTREGADO gana** (upgrade); dedup **cross-source**.
4. **Arista B (pre-ruta):** en bodega-FedEx (`allowSameDayPreRegistrationFedexEvents`), un evento FedEx del **mismo día** anterior al `EN_RUTA` de la ruta **gana** (la ruta es captura tardía). Sucursales normales: Time Shield sin cambios.
5. **+ Barrida diaria 1×/día** sobre la cola pendiente restante.
6. **Shadow apagado** mientras el cutover esté ON.

## 3. Componentes (nuevos/ajustados)

### 3.1 Selector por rutas del día
- `getShipmentIdsForTodayRoutes(): Promise<string[]>` — guías (shipment ids) de `package_dispatch` con `routeDate = hoy` (rango del día Hermosillo), **excluyendo** `TERMINAL_SHIPMENT_STATUSES`. Read-only.
- El sync frecuente hace `compare.applyMany(ids, actor)` con ese conjunto (priorizado por cadencia).

### 3.2 Cron de sync frecuente (rutas del día)
- `@Cron('0 */15 * * * *')` (cada 15 min). Gateado por `isCutoverEnabled()`.
- **Ventana horaria:** solo corre si la hora Hermosillo ∈ [`FEDEX_SYNC_START_HOUR`=7, `FEDEX_SYNC_END_HOUR`=22). Fuera de eso, no-op.
- Guard `running` anti-solape.
- Reemplaza/convive con `TrackingSyncPersistCron` (que hacía el "todo"): el frecuente pasa a rutas-del-día; el "todo" se mueve a la barrida diaria.

### 3.3 Cron de barrida diaria
- `@Cron('0 0 5 * * *', tz Hermosillo)` (o similar). Gateado por cutover.
- Procesa `getShipmentsToValidate()` (la cola pendiente completa) — respaldo para resoluciones fuera de ruta. Menos frecuente = barato.

### 3.4 Cobro unificado (IncomeExecutor)
Antes de crear un ingreso, busca **cualquier** `Income` de `(trackingNumber, semana)` (lun–dom, **una** definición canónica compartida), sin importar el origen:
- **No existe** → crea (con `sourceEventKey`).
- **Existe ENTREGADO** → no hace nada.
- **Existe NO_ENTREGADO y llega ENTREGADO** → **upgrade** ese mismo registro a `ENTREGADO` (actualiza `incomeType`, `date`, `sourceEventKey`, `nonDeliveryStatus=null`). No crea un segundo.
- **Existe no-entregado y llega no-entregado** → no duplica.
- Cierra de paso el hueco #1/#5 (semana única) y el doble-cobro cross-source.

> Dirección inversa (cierre de ruta cobrando sobre un ingreso del motor): su dedup ya busca por guía/semana; se **verifica** que reconozca los ingresos del motor (con `sourceEventKey`) y, si no, se alinea su chequeo. (Tarea de verificación en el plan.)

### 3.5 Time Shield — arista B
`TimeShieldRule`: si `subsidiary.allowSameDayPreRegistrationFedexEvents` y el evento FedEx más reciente es del **mismo día calendario (Hermosillo)** que hoy/la ruta → **no** aplica el escudo (FedEx gana sobre el `EN_RUTA` de captura tardía). En sucursales normales, comportamiento actual (protege el EN_RUTA).

### 3.6 Shadow off en cutover
`TrackingSyncCron` (shadow :15): `if (isCutoverEnabled()) return;` — evita duplicar llamadas a FedEx.

## 4. Config (env)

- `TRACKING_SYNC_CUTOVER` (existente) — enciende todo el motor persistente.
- `FEDEX_SYNC_START_HOUR=7`, `FEDEX_SYNC_END_HOUR=22` — ventana del sync frecuente (hora Hermosillo).
- `TRACKING_SYNC_CUTOVER_CAP` (existente, opcional) — tope por corrida.

## 5. Coexistencia / seguridad

- Legacy (`processMasterFedexUpdate`/`generateIncomes`/cron legacy) **intacto**; corre cuando el cutover está OFF.
- `getShipmentsToValidate` sigue existiendo (lo usa la barrida diaria).
- Todo nuevo o ajuste aditivo detrás del flag.

## 6. Pruebas

- Selector rutas-del-día excluye terminales y toma `routeDate=hoy`.
- Ventana horaria: no corre fuera de 7–22.
- IncomeExecutor: upgrade NO_ENTREGADO→ENTREGADO (no duplica); ENTREGADO existente → skip; cross-source (existe ingreso sin `sourceEventKey` → no re-cobra); semana canónica.
- TimeShield bodega-FedEx: evento mismo día anterior al EN_RUTA gana; sucursal normal → protege EN_RUTA.
- Shadow off cuando cutover on.

## 7. Fuera de alcance

- Tocar el cierre de ruta (solo se verifica su dedup; se ajusta solo si es necesario).
- DHL (el motor es FedEx-only; sus cobros siguen en el cierre de ruta).
- Encender el cutover (queda OFF hasta validar).

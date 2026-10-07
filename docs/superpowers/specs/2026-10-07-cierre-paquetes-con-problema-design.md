# Cierre de ruta: "Paquetes con problema" (superadmin)

Fecha: 2026-10-07 · Repos: pmy-api + app-pmy · Rama: `feat/cierre-paquetes-con-problema`

## Objetivo

Dentro del cierre de ruta, un **superadmin** puede ver la lista automática de paquetes de la
salida que tienen algo inconsistente contra FedEx (estatus, historial `shipment_status`,
ingreso), leer una explicación en lenguaje simple de cada uno y decidir si aplica el arreglo
propuesto, uno por uno o por selección.

No sustituye la reconciliación automática que corre al abrir el cierre
(`reconcileRouteWithFedex`); cubre lo que esa no puede o no debe arreglar sola, en particular:

- Estatus **finales** (`ENTREGADO`, `DEVUELTO_A_FEDEX`): desde 2026-10-06 ningún proceso
  automático les escribe (`persistent-sync.sink.ts`). Este flujo manual sí puede, con
  confirmación explícita.
- Desenlaces de FedEx de **días anteriores a la ruta** (p. ej. Loreto: entregado el 30/09,
  puesto en ruta el 06/10). La reconciliación automática solo cobra eventos del día de la ruta.

## Alcance

- Todos los paquetes de la salida (shipments y cargas F2), sin importar el bucket del cierre.
- Solo se muestran los que tienen al menos un problema.
- Todas las sucursales.
- Solo superadmin (backend con `SuperAdminGuard`, frontend oculta el botón).

## Problemas que detecta

El diagnóstico usa el **último desenlace real de FedEx, de cualquier día** (no se ancla al día
de la ruta).

| Código | Problema | Arreglo | Cargas F2 / ruta 31.5 |
|---|---|---|---|
| `STATUS_BEHIND` | `shipment.status` ≠ último estatus FedEx (incluye estatus finales) | Actualizar estatus + insertar eventos FedEx faltantes | Sí |
| `DELIVERED_BEFORE_ROUTE` | FedEx entregó (o devolvió) **antes** del día de la ruta | Igual que `STATUS_BEHIND`; la explicación muestra ambas fechas y los días de diferencia | Sí |
| `HISTORY_MISSING` | `shipment.status` ya es correcto pero `shipment_status` no tiene el evento FedEx que lo respalda | Insertar solo los eventos FedEx faltantes (fecha/hora reales) | Sí |
| `INCOME_MISSING` | El desenlace cobra y no hay ingreso, o hay un DEX del mismo día que debe pasar a ENTREGADO | Crear / reemplazar Income según `reconcileShipmentIncomeAction` | **Nunca** (cargas F2 y rutas `is315` no generan ingreso) |
| `WARNING` | Algo no cuadra pero no se corrige aquí (ingreso ENTREGADO y FedEx dice no entregado; FedEx sin datos; error consultando) | Ninguno; solo explicación (referir al Consolidador) | — |

Un paquete puede traer varios problemas. Sus arreglos se aplican **juntos** (no se separan
estatus e ingreso, para no dejar un ingreso sin el estatus que lo justifica).

### Reglas de ingreso

- Reutiliza `noVanIncomeDecision` + `reconcileShipmentIncomeAction` (sin cambios de reglas):
  ENTREGADO gana a DEX del mismo día, nunca se degrada un ENTREGADO, idempotente, DEX08 solo
  con 3 días distintos con 08 en la misma semana.
- Anti-duplicado: si la guía ya tiene un Income ENTREGADO de **cualquier** día (p. ej. de otra
  ruta), no se crea otro.
- **Fecha del ingreso = instante real del evento FedEx** (decisión del usuario, opción A),
  aunque sea de una semana pasada. Si cae en una semana distinta a la de la ruta, la
  explicación lo avisa: *"este ingreso cae en la semana del 29-sep, ya pasada"*.
- Costo = `subsidiary.fedexCostPackage` de la sucursal de la salida (igual que hoy); si es 0,
  aviso en la explicación.

### Explicaciones (ejemplos)

- *"FedEx reporta ENTREGADO el 30-sep 11:05. La guía se puso en la ruta del 06-oct (6 días
  después). Se corrige el estatus a entregado, se agrega el evento con su fecha real y se crea
  el ingreso de $59 con fecha 30-sep (semana del 29-sep, ya pasada)."*
- *"La guía ya dice entregado, pero falta ese evento en su historial. Se agrega el evento de
  FedEx del 06-oct 14:32. No se crea ingreso porque ya existe uno."*
- *"Es una carga F2: se corrige el estatus, no genera ingreso."*

Lenguaje simple, sin tecnicismos; se permiten códigos de dominio (DEX08, F2, consolidado).

## Backend (pmy-api)

### Unidades

- `src/routeclosure/closure-doctor.util.ts` — **pura**, sin I/O.
  `diagnosePackage(input) → PackageDiagnosis`. Entrada: entidad (id, kind, status), filas de
  `shipment_status`, eventos FedEx normalizados (todos + último), ingresos existentes de la
  guía, datos de la salida (`routeDate`/`createdAt`, `is315`, costo, nombre sucursal), fechas
  DEX08. Salida: problemas, arreglos planeados, explicación y `fingerprint`.
- `fingerprint` = hash estable (sha1) del plan normalizado: estatus destino, claves de eventos
  a insertar, acción de ingreso (tipo, fecha, costo).
- `src/routeclosure/closure-doctor.service.ts` — I/O:
  - `diagnoseRoute(dispatchId)`: junta los items de la salida (mismo universo que
    `applyByRoute`), consulta FedEx con concurrencia 6 vía `TrackingCompareService`
    (método nuevo público que regresa el contexto construido sin persistir), carga historial
    e ingresos, llama a `diagnosePackage`. Devuelve solo paquetes con problemas.
  - `applyFixes(dispatchId, items[{ shipmentId, kind, fingerprint }], actor)`: por paquete
    vuelve a diagnosticar; si el `fingerprint` no coincide → `{ status: 'changed' }` sin
    aplicar. Si coincide, en **una transacción por paquete**: inserta eventos faltantes
    (dedupe por shadowKey dentro de la TX, como el sink), actualiza estatus (ignorando el
    candado de estatus final, solo en este flujo), crea/actualiza Income. Un fallo de un
    paquete no detiene a los demás.

### Endpoints (`route-closure`)

- `POST route-closure/:packageDispatchId/diagnose` → `{ dispatch, packages: PackageDiagnosis[] }`
- `POST route-closure/:packageDispatchId/apply-fixes` body `{ items: [...] }` →
  `{ results: [{ shipmentId, kind, status: 'applied' | 'changed' | 'error', message }] }`
- Ambos con `@UseGuards(SuperAdminGuard)`. `apply-fixes` queda auditado (interceptor de
  auditoría existente) con el usuario; `diagnose` con `@NoAudit()`.

### Pruebas

`closure-doctor.util.spec.ts`: cada código de problema; entregado antes de la ruta (30/09 vs
06/10) con ingreso fechado al evento y aviso de semana pasada; historial faltante con estatus
final; carga F2 sin ingreso; ruta 31.5 sin ingreso; ingreso existente de otra ruta (no
duplica); DEX mismo día → supersede; DEX08 sin 3 visitas → sin ingreso; FedEx sin datos →
WARNING; fingerprint estable e idéntico para el mismo plan.
`closure-doctor.service.spec.ts`: `applyFixes` con fingerprint distinto → `changed`; fallo
aislado por paquete.

## Frontend (app-pmy)

- En el cierre (`close-package-dispatch-form.tsx`), solo si `user.role` es superadmin: botón
  **"Paquetes con problema"** en el OperationHeader.
- Abre un panel (Sheet/Dialog shadcn) que llama `diagnose` con estado de carga.
- Lista densa (un renglón por paquete): palomita, guía, Paquete/Carga F2, pastillas de
  problemas, estatus actual → propuesto; al expandir, la explicación.
- Paquetes solo con `WARNING`: sin palomita.
- **"Aplicar seleccionados"** → confirmación con resumen ("3 estatus, 2 eventos, 1 ingreso de
  $59; 1 cae en semana pasada") → `apply-fixes` → resultado por paquete (aplicado / cambió,
  vuelve a revisar / error) → recarga los buckets del cierre y el diagnóstico.
- Componente propio `components/package-dispatch/closure-doctor-panel.tsx`; solo shadcn +
  Tailwind; textos en lenguaje simple.

## Fuera de alcance

- Anular o corregir ingresos cobrados de más (queda como WARNING → Consolidador).
- Cambios al cron, al motor tracking-sync o a la reconciliación automática del cierre.
- DHL.

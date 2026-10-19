# Consolidador por zona + cargas, recolecciones y No VAN — diseño

Fecha: 2026-10-19 · Repos: pmy-api + app-pmy · Maqueta aprobada en lo general: https://claude.ai/artifact/7SjeDhDe8ZKPozpVutvmuG

## Por qué

Una sola persona revisa los cobros de todas las sucursales. Hoy el Consolidador (Finanzas → Consolidador) obliga a ir sucursal por sucursal, y el conteo manual solo cruza contra paquetes. En la auditoría de Cabo San Lucas (12–17 oct, `docs/auditorias/2026-10-19-cabo-conteo-manual-vs-sistema.md`) salieron diferencias que la pantalla no explicaba:

- 23 guías que estaban como **paquete y como carga** (se pegó el master con la hoja F2 y luego la F2) y cobraron dos veces.
- Guías que la persona contó y que el sistema solo tiene como **No VAN** del cierre de ruta (`shipment_not_in_files`): no son `shipment`, así que hoy salen como "no existe".
- Recolecciones registradas que nadie contó.

## Objetivos

1. Todo el Consolidador se puede ver **por zona** además de por sucursal. En zona, cada dato dice a qué sucursal pertenece y las tablas se agrupan por sucursal con subtotales.
2. Pantalla de entrada **Resumen**: una fila por sucursal con el estado de la semana y qué revisar primero (aprobado por el usuario tal como está en la maqueta).
3. El **conteo manual** cruza contra paquetes, **cargas** (`charge_shipment`), **recolecciones** y **No VAN**, y explica en palabras dónde está cada guía.
4. La **auditoría de cobros** suma tres tablas: Cargas (con las guías dobles), Recolecciones y No VAN.
5. Pantalla más simple: 4 pestañas ordenadas por pregunta y buscar guía en el header.

## No objetivos

- No se cambian las reglas de cobro ni el motor (cron, cierre, tracking-sync). Tampoco se bloquea en la subida que una guía F2 entre como paquete; eso es otra decisión pendiente.
- No se anula ni se genera nada automáticamente. Toda corrección es un botón por guía, con motivo, y reusa los endpoints que ya existen.
- No se toca nada fuera de Finanzas → Consolidador (más el permiso nuevo).
- Las zonas no se administran aquí; se usan las de Administración → Zonas (`zone`, `subsidiary.zoneId`). El usuario completará las asignaciones que faltan.

## Anti-objetivos (sería un fracaso aunque funcione)

- Que en zona se mezclen guías sin decir de qué sucursal son.
- Que la vista por zona tarde tanto que la persona prefiera seguir yendo sucursal por sucursal.
- Mensajes técnicos ("charge_shipment", "shipment_not_in_files", "intake") en pantalla. Se dice "carga", "No VAN", "recolección".

## Decisiones del usuario

- Zonas: las existentes de Administración → Zonas.
- Resumen: se queda como en la maqueta y es la pestaña de entrada.
- Conteo manual: por ahora solo superadmin, pero con **permiso propio** que se pueda asignar después.
- Regla de la casa: diseño aprobado antes de programar; UI solo shadcn + Tailwind dentro de AppLayout/withAuth/OperationHeader; tablas con DataTable; acciones fuertes en el header; textos en llano.

## Cómo queda la pantalla

### Header (OperationHeader)

- Botón segmentado **Zona | Sucursal**. En Zona, un Select de zonas (`useZones`) y la leyenda "N sucursales". En Sucursal, el `SucursalSelector` de hoy.
- **Buscar guía o consolidado** (Ctrl K): abre en un Sheet lateral la vista que hoy es la pestaña "Buscar paquete" (`SearchPackageView`), sin cambiar su lógica.
- **Más acciones** (DropdownMenu): Anomalías, Corregir fechas (superadmin, como hoy) y Exportar.
- **+ Agregar ingreso**: igual que hoy. En zona pide la sucursal dentro del diálogo.

Debajo, el selector de semana (lun–dom, `lib/week`). En zona, además, pastillas por sucursal (Todas + una por sucursal) con un punto de color: rojo si hay faltantes o cobros de más, ámbar si solo hay avisos, verde si cuadra. Al elegir una pastilla se filtra esa sucursal en todas las pestañas, sin salir de la zona. El modo, la zona y la sucursal se recuerdan por usuario (localStorage, como otros selectores).

### Pestañas

1. **Resumen** (nueva, entrada). KPIs de la zona: cobrado, falta cobrar, cobrado de más, paquete + carga, No VAN (cobradas / sin cobro). Tabla por sucursal: cobrado, falta cobrar (monto · guías), de más, paquete + carga, recolecciones (cobradas / registradas), No VAN, estado del último conteo manual y "Qué revisar primero". Clic en la fila = elegir esa pastilla. En modo Sucursal muestra una sola fila.
2. **Conteo manual** (permiso `finanzas.consolidador.conteoManual`).
3. **Auditoría de cobros**, con subpestañas Reglas de cobro · Cargas · Recolecciones · No VAN.
4. **Detalle**: un segmentado Por ruta | Por consolidado | Ingresos (lo de hoy) más "Agrupar por sucursal | Todo junto" en zona.

## Backend

### Alcance (zona o sucursal)

- Util puro `resolveScope({ zoneId?, subsidiaryId? }, user)` → lista de sucursales `{ id, name }`. En zona: `subsidiary.zoneId = :zoneId` y activas, ordenadas por nombre. Para usuarios no globales se recorta a sus `subsidiaryIds`; si no queda ninguna, 403 en llano.
- Las rutas de zona viven bajo `consolidador/zone/:zoneId/...` y se declaran **antes** del comodín de 3 segmentos `:subsidiaryId/:fromDate/:toDate`. `ConsolidadorAccessGuard` ya valida `:subsidiaryId`; para zona se valida dentro de `resolveScope`.
- Cada endpoint de zona llama al servicio por sucursal que ya existe y **agrega** `subsidiaryId` y `subsidiaryName` a cada fila o grupo. Concurrencia máxima 2 sucursales a la vez: la máquina de desarrollo tiene 8 GB y hay que cuidar la BD.

Endpoints de zona (mismo contrato que su par por sucursal, más la sucursal en cada fila):

| Zona | Reusa |
|---|---|
| `GET zone/:zoneId/:from/:to` (ingresos) | `getWeek` |
| `GET zone/:zoneId/:from/:to/by-route` / `by-consolidado` | `ConsolidadorGroupsService` |
| `GET zone/:zoneId/:from/:to/cobros-audit` | `CobrosAuditService` |
| `GET zone/:zoneId/:from/:to/summary` | nuevo (ver abajo) |
| `GET zone/:zoneId/:from/:to/charge-guides`, `collections`, `novan` | nuevos (ver abajo) |
| `POST zone/:zoneId/:day/manual-count` (+ `/prompt`) | `ManualCountService` |

Las tres tablas nuevas y el resumen también tienen versión por sucursal (`:subsidiaryId/:from/:to/summary`, etc.). La versión de zona es la de sucursal en un ciclo.

### Resumen (`summary`)

Por sucursal: `incomeTotal`, `packages`, `charges` (lectura de ingresos que ya existe, `active=1`); `missing{count,amount}` y `extra{count,amount}` (CobrosAudit, más los dobles cobrados y los No VAN sin cobro); `doubles` (paquete + carga); `collections{registered,charged}`; `novan{total,charged}`; `lastManualCount` (ver abajo); `topIssue`, una frase armada por un util puro que elige la diferencia más cara ("31 guías sin subir del correo …", "23 guías como paquete y carga", "2 recolecciones sin cobro", "Falta pegar el conteo manual", "Nada pendiente").

### Cargas: guías dobles (`charge-guides`)

- Guías de `charge_shipment` (`active=1`) cuyas cargas (`charge`) caen en la semana de la sucursal, con `charge.consNumber`, `charge.chargeDate`, fecha de subida y quién subió (`import_file`, porque `charge.createdById` viene vacío).
- **Doble** = existe `shipment` de la misma guía en la misma sucursal (`active`, sin importar el consolidado) cuyo consolidado es de la misma semana o de la anterior. Se muestra el consolidado del paquete, la hora de subida y su `Income` activo (`sourceType='shipment'`, `shipmentId`).
- Doble con ingreso de paquete activo = **cobrado de más** por `fedexCostPackage`. Acción: **Anular cobro del paquete**, con el `DELETE` de ingreso del consolidador que ya existe (soft delete + `income_change_log`). Solo se anula el ingreso del paquete, nunca la carga. Regla de la casa (nunca clonar registros): no se borra ni se mueve el `shipment`.
- El ingreso del paquete se busca por `income.shipmentId` y, si viene vacío (ingresos creados entre el 19-oct y el fix de `insert:false`), por `trackingNumber` + `sourceType='shipment'` + sucursal + semana.
- Filtro por defecto: "Solo dobles"; "Todas" muestra todas las guías de las cargas agrupadas por carga.
- La detección es un util puro `detectChargeDoubles(chargeGuides, shipments, incomes)` con tests.

### Recolecciones (`collections`)

- Tabla `collection` de la semana (día por `createdAt` en hora Hermosillo, reusa `collectionDayOf`), con ruta y si es 31.5 (`route_closure.collections` + `package_dispatch.is315`, como el conteo), el ingreso (`sourceType='collection'`) y el estado: Cobrada, Sin cobro, No cobra (31.5), Duplicada.
- **FedEx "recogido"** no se consulta al abrir la tabla (sería muy lento). Se muestra lo que haya en caché y un botón **Verificar con FedEx** que consulta por lotes de 25, igual que el prefetch del conteo manual.
- Acción en "Sin cobro" con FedEx recogido: **Generar cobro**, reusando el alta manual de recolección del consolidador (con anti-duplicado 409).

### No VAN (`novan`)

- `shipment_not_in_files` de la semana por la fecha de la ruta (`package_dispatch.routeDate` vía `dispatchId`; si falta, la fecha del `route_closure`), con ruta, chofer, hora del cierre, si la ruta es 31.5 y el ingreso por guía (`income.trackingNumber`, `sourceType='shipment'`, activo).
- Estado: Cobrada · Sin cobro · No cobra (31.5) · Sin cobro porque FedEx dice en tránsito (se reusa `noVanIncomeDecision` con el estatus FedEx actual).
- "FedEx hoy": desde la caché de FedEx más el botón **Verificar con FedEx** por lotes.
- Acción en "Sin cobro" cuando FedEx dice entregado o DEX que cobra: **Generar cobro** con el alta manual del consolidador (tipo POD o DEX, guía, fecha = día de la ruta, `fedexCostPackage`), con motivo y anti-duplicado.

### Conteo manual

- Hoy el cruce ya carga `charge_shipment` como hecho (`kind 'charge'`). Se agregan:
  - **No VAN** como hecho nuevo (`kind 'novan'`) en `loadFacts`: si la guía no existe como paquete ni carga pero sí en `shipment_not_in_files` de la sucursal, ya no sale `NO_EXISTE`; se diagnostica con su ruta, día, FedEx e ingreso. Causas nuevas: `NOVAN_COBRADO` (cuadra), `NOVAN_SIN_COBRO` (error de sistema, acción Generar cobro), `NOVAN_31_5` (regla, no cobra).
  - **Doble paquete + carga**: causa nueva `DOBLE_PAQUETE_CARGA`. La guía existe como `shipment` y como `charge_shipment` y el paquete tiene ingreso activo → cobrado de más. Acción: Anular cobro del paquete.
  - **Recolecciones**: la caja ya existe; solo cambia la presentación.
  - **Casillas "Comparar también contra"**: Cargas, Recolecciones, No VAN, todas prendidas por defecto. Apagar una la quita del cruce. Sirve para comparar contra un conteo que no las incluye.
- **Varias sucursales**: en zona, el endpoint de zona primero ubica cada guía pegada en una sucursal de la zona (shipment, charge_shipment, collection o No VAN; si hay varias, gana la del registro vigente ese día con `pickShipmentRowForDay`). Agrupa por sucursal y corre el diagnóstico de cada una con su parte. Las guías que no aparecen en ninguna sucursal de la zona van al grupo "Sin sucursal" como `NO_EXISTE`. La comparación "cobrado y no lo contó" se hace contra el universo de todas las sucursales de la zona.
- **Último conteo** (para el Resumen): tabla nueva `manual_count_run` (migración) con `id, subsidiaryId, scope ('day'|'week'), fromDay, toDay, counted, matched, differences, missingAmount, extraAmount, createdById, createdAt`. Se escribe un renglón por sucursal cada vez que se corre el conteo. Las listas pegadas no se guardan, solo los totales.
- Tipos espejo `manual-count.types.ts` ↔ `app-pmy lib/types/manual-count.ts`, se mantienen en sincronía.

### Permiso

- Catálogo: `{ code: 'finanzas.consolidador.conteoManual', name: 'Consolidador · Conteo manual', groupName: 'Finanzas', roles: ['superadmin'] }`.
- Migración `Sync…Permission` idempotente, como la 066, con el número siguiente libre al implementar (hoy la última es 111) y `down` que solo borra ese código.
- BE: los endpoints `manual-count*` usan `@RequirePermission('finanzas.consolidador.conteoManual')` + `PermissionsGuard` (superadmin pasa por bypass) en lugar del chequeo de rol de hoy.
- FE: la pestaña se muestra con `hasPermission(user, 'finanzas.consolidador.conteoManual')`.
- Las tres tablas nuevas y el Resumen usan el permiso de siempre, `finanzas.consolidador`.

## Frontend (app-pmy)

- `app/finanzas/consolidador/page.tsx` se reorganiza: estado `scope = { mode: 'zone'|'subsidiary', zoneId, subsidiaryId, focusSubsidiaryId }`. Un hook `useConsolidadorScope` arma la URL (zona o sucursal) para todos los hooks SWR. Las pestañas cargan solo cuando están activas, como hoy.
- Componentes nuevos en `components/consolidador/`: `scope-switcher.tsx`, `subsidiary-pills.tsx`, `summary-view.tsx`, `charge-guides-table.tsx`, `collections-audit-table.tsx`, `novan-table.tsx`, `search-sheet.tsx`. `cobros-audit-panel.tsx` pasa a tener subpestañas. `groups-view.tsx` y la tabla de Ingresos ganan columna/agrupación por sucursal.
- Todas las tablas usan `DataTable`. La agrupación por sucursal se hace con un renglón encabezado con subtotal (como la maqueta), y la columna Sucursal es filtrable.
- Conteo manual: las 4 cajas en una fila con contador, la fila de casillas "Comparar también contra" y el botón Comparar. El resultado lleva 4 KPIs (Cuadra / Contó y no está cobrado / Cobrado y no lo contó / Error de conteo), una leyenda de etiquetas (No VAN · Carga · Recolección · Doble) y una tabla agrupada por sucursal con las columnas Guía · Contó · Dónde está en el sistema · Qué pasó (frase + quién/cuándo) · Monto · Acción. Se mantienen el filtro "Con diferencia" por defecto, el Excel y el prompt.
- Lógica pura (agrupar, subtotales, color de la pastilla, frase de "qué revisar") en `lib/consolidador/*.ts` con Vitest (environment node).
- Mientras carga una zona se usa el loader oficial (`PmyLoader`).

## Pruebas

- BE Jest: `resolveScope`, `detectChargeDoubles`, `topIssue`, clasificación de No VAN, ubicación de guías por sucursal en zona y las causas nuevas del diagnóstico.
- FE Vitest: agrupación/subtotales, color de pastilla, armado de URL por alcance.
- Verificación contra BD local con Cabo 12–17 oct: deben salir las 23 dobles de la auditoría y los totales del Resumen deben empatar con el dashboard de la semana.

## Lo que decide quien construye

- Nombres internos, forma exacta de los DTO y orden de las columnas secundarias.
- Si el Sheet de búsqueda es Sheet o Dialog de shadcn.
- Cuántas guías se muestran por grupo antes de "Ver todas".

## Decisiones mías (revisar)

1. "Doble" = guía como paquete y como carga en la **misma sucursal** y con consolidados de la misma semana o la anterior. El cobro de más que se anula es siempre el del **paquete**.
2. Tabla nueva `manual_count_run` para que el Resumen muestre el último conteo. Sin ella esa columna no se puede llenar.
3. FedEx en Recolecciones y No VAN se consulta con un botón y por lotes, no al abrir la pestaña.
4. En zona, un usuario no global solo ve las sucursales de la zona que tiene asignadas.
5. Buscar paquete pasa al header como panel lateral; Anomalías y Corregir fechas pasan a "Más acciones".

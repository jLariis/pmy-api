# Tareas del día (checklist automático por consolidado)

Fecha: 2026-10-17 · Repos: `pmy-api` + `app-pmy`

## Por qué

El flujo de cada sucursal es **Consolidado → Desembarque → Rutas → Devoluciones → Inventarios**. Hoy no hay
forma de saber qué paso falta: solo se descubre por casualidad en la bandeja de correos o revisando el
historial de quién subió qué. Queremos una pantalla que funcione como guía del día: el sistema detecta
solo lo que ya se hizo y lo va tachando, muestra lo que falta y avisa (app, correo, WhatsApp) cuando algo
se atrasa o se completa.

## Metas

- Pantalla **Tareas del día**: por sucursal y por semana (lunes a domingo). Abre en el día de hoy y deja
  ver días y semanas anteriores.
- Checklist **de solo lectura**: el usuario no puede marcar ni desmarcar nada; todo lo detecta el sistema.
- Dos niveles de tareas:
  - **Por consolidado** (master, F2/carga, aéreo, DHL): subido, desembarque, salidas a ruta, cierre de
    rutas y devoluciones de sus guías DEX.
  - **Por sucursal y día**: inventario inicial, cerrar todas las rutas, registrar devoluciones e
    **inventario final de día** (antes de las 20:00, porque el sistema se suspende a las 21:30).
- Cada paso muestra quién lo hizo y a qué hora, su avance parcial (121/124, 1 de 3 rutas) y si va tarde.
- Detalle de paquetes por consolidado: entregados, en ruta, DEX por código (03/07/08…), devueltos a
  FedEx, en bodega o inventario, **posibles LD** y guías que faltaron en el desembarque.
- Avisos (el usuario aprobó horarios y canales de la maqueta):
  - **App (campana):** cuando un paso se atrasa y cuando se completa.
  - **Correo:** resumen de cierre del día a las 19:00 con lo que falta.
  - **WhatsApp:** solo atrasos importantes, como el inventario final que no se hizo a las 20:00 o un
    consolidado que lleva mucho tiempo sin salida a ruta.
- Todos los roles pueden usarla. Se puede cambiar de sucursal entre las que cada quien tiene permitidas.

## Fuera de alcance

- Marcar tareas a mano, asignarlas a personas o agregar tareas libres.
- Cambiar cómo se hace cada paso (desembarque, cierre, etc.). Esta pantalla solo lee y avisa.
- Corregir datos desde aquí. Cada renglón lleva a la pantalla donde se hace el paso.

## Qué sería un fracaso aunque funcione

- Que la pantalla diga "listo" cuando no lo está, o al revés. La confianza en el checklist lo es todo.
- Que el número de posibles LD no coincida con los reportes de LD.
- Que los avisos lleguen repetidos o fuera de horario (después de las 21:30), o que nadie los lea.
- Pantalla lenta. Tiene que abrir en pocos segundos aunque sea la semana completa.

## Lo que ya existe y se reutiliza

- **`ops-alerts`** (pmy-api, revisión cada 5 min en `OpsAlertsCron`): ya calcula el recorrido de
  subido → desembarque → salida → cierre → inventario, con plazos configurables (`OpsAlertSettings`),
  escalamiento por niveles, pasos activables por sucursal (`OpsAlertSubsidiary`), grupos y números de
  WhatsApp, resumen a grupos y la tabla `ops_alert` (un registro por paso y referencia, sin duplicar avisos).
  **Límite actual:** solo revisa los consolidados que llegaron por correo (`inbox_consolidation`).
- **`LifecycleService.aggregate`**: cuenta por consolidado las guías desembarcadas, en ruta
  (`package_dispatch_history`) y con ruta cerrada (`route_closure`), con la primera y la última hora. Cubre
  master/aéreo (`consolidated → shipment`) y F2 (`charge → charge_shipment`).
- **Regla de LD** (hoy repetida en 3 lugares: `inventories.service.ts` reporte LD,
  `package-dispatch.service.ts` y `shipments.service.ts` `ldState`): la guía vence ese día
  (`commitDateTime`, día de Hermosillo), no está entregada, no tuvo DEX válido (`LD_QUALIFYING_SQL_IN`) en
  su día de vencimiento y no tuvo movimiento FedEx ese día.
- Notificaciones: `notification` + `notification-catalog.ts` + `NotificationDispatchService` (correo y
  WhatsApp) y `SendLogService` (bitácora de envíos).
- Inventarios con `type` = `initial` / `dex` / `final`.
- Semana lunes–domingo: `app-pmy/lib/week.ts` y `pagination.util.ts`.

## Diseño

### Backend (pmy-api)

1. **Una sola regla de LD.** Sacar la regla a `src/common/ld-rule.util.ts` (función pura + SQL) y hacer
   que los 3 lugares actuales y esta pantalla la usen. Durante el día se muestran los **posibles LD** (todavía
   pueden salvarse); al terminar el día, los que sigan así son LD.
2. **Recorrido de todos los consolidados.** Generalizar `LifecycleService` para que trabaje por
   `consolidated.id` / `charge.id` (no solo por `consNumber` de la bandeja de correos) y agregar:
   - devoluciones: guías del consolidado en estatus DEX contra registros en `devolution` (sin `undoneAt`);
   - resumen de paquetes por estatus actual (entregado, en ruta, DEX por código, devuelto, en bodega,
     inventario, faltantes de desembarque, posibles LD).
3. **Tabla nueva `daily_task`**: una fila por (sucursal, día, referencia, paso).
   - Columnas: `subsidiaryId`, `day` (date local), `refType` (`consolidated` | `charge` | `subsidiary`),
     `refId`, `consNumber`, `step` (`upload` | `unloading` | `dispatch` | `closure` | `devolutions` |
     `inventory_initial` | `inventory_final`), `status` (`pending` | `partial` | `done` | `late`),
     `doneCount`, `totalCount`, `dueAt`, `doneAt`, `doneById`, `doneByName`, `updatedAt`.
   - Índice único (`subsidiaryId`, `day`, `refType`, `refId`, `step`).
   - El cron de `ops-alerts` (cada 5 min) recalcula los días abiertos de la semana y guarda los
     **cambios de estado**; esos cambios disparan los avisos. Al abrir la pantalla se puede pedir un
     recálculo del día que se está viendo.
   - Para qué sirve: abrir la semana rápido, guardar el historial aunque luego cambien los datos y saber
     exactamente cuándo se completó cada paso.
4. **Tabla nueva `daily_ld`**: foto de los LD al cerrar el día (cron 20:30): `subsidiaryId`, `day`,
   `trackingNumber`, `shipmentId` / `chargeShipmentId`, `consNumber`, `status`, `createdAt`. Los días
   pasados leen de aquí; hoy se calcula en vivo.
5. **Avisos** sobre el motor de `ops-alerts`: se agregan los pasos `devolutions`, `inventory_initial` e
   `inventory_final`; `ops_alert` gana `consolidatedId` / `chargeId` (nullable) junto al
   `inboxConsolidationId` actual. Tipos nuevos en `notification-catalog.ts`:
   `tareas.paso_atrasado` (campana; WhatsApp solo en el nivel de escalamiento configurado),
   `tareas.paso_completo` (campana), `tareas.resumen_dia` (correo, 19:00),
   `tareas.inventario_final_pendiente` (campana 19:00; WhatsApp 20:00). Nunca se avisa fuera de
   `activeFrom`–`activeTo` (06:00–21:30).
6. **Endpoints** (`/daily-tasks`, permiso nuevo `operaciones.tareas`, acotado a las sucursales visibles):
   - `GET /daily-tasks/week?subsidiaryId&weekStart` → resumen por día (avance %, pasos atrasados).
   - `GET /daily-tasks/day?subsidiaryId&day` → tareas de la sucursal + consolidados con su checklist.
   - `GET /daily-tasks/consolidated/:refType/:refId` → detalle de paquetes y listas de guías
     (faltantes, posibles LD, DEX sin devolución).
7. **Horarios por sucursal** (pedido del usuario: cada sucursal define los suyos; de inicio, todas con
   los mismos valores). Columnas nuevas en `ops_alert_subsidiary`, cada una con su valor predefinido:

   | Paso | Columna | Predefinido |
   |------|---------|-------------|
   | Subir consolidado | `uploadMinutes` | 30 min después de que llega el correo |
   | Desembarque | `unloadingTime` | 21:00 (o 2 h después de subido si se sube más tarde) |
   | Salida a ruta | `dispatchAfterUnloadMinutes` | 120 min después del desembarque |
   | Salida a ruta (respaldo) | `dispatchNextDayTime` | 10:00 del día siguiente, si las 2 h caen después de `activeTo` (21:30) |
   | Cierre de rutas | `closureTime` | 21:00 del día de la salida |
   | Inventario inicial | `inventoryInitialTime` | 10:00 |
   | Devoluciones | `devolutionsTime` | 19:30 |
   | Inventario final de día | `inventoryFinalTime` | 20:00 (aviso previo a las 19:00) |

   La revisión lee primero la configuración de la sucursal; si una columna está vacía, usa el valor
   general de `OpsAlertSettings` (que sigue existiendo como respaldo). Se editan en la pantalla actual de
   configuración de alertas, en la sección de cada sucursal, con un botón "Usar valores generales".
8. **Migraciones**: `daily_task`, `daily_ld`, columnas nuevas en `ops_alert`, pasos y horarios nuevos en
   `ops_alert_subsidiary` (llenados con los predefinidos para todas las sucursales) y permiso
   `operaciones.tareas`. Siempre por migración (DB_SYNC=false).

### Frontend (app-pmy)

- Ruta `app/operaciones/tareas-del-dia/page.tsx` dentro de `AppLayout` + `withAuth` + `OperationHeader`,
  solo con shadcn y Tailwind, en modo denso (un renglón por elemento, pastillas) y con lenguaje simple.
- **Header (barra de tareas):** selector de sucursal (`w-56`), selector de semana lunes–domingo, botón de
  avisos y el texto "El sistema se suspende 21:30".
- **Cinta de días** L M M J V S D de la semana elegida, cada uno con su avance; se abre en hoy.
- **Indicadores:** avance del día, consolidados listos, pendientes urgentes y posibles LD.
- **Tareas de la sucursal** (bloque arriba) y **Posibles LD** (lista corta con enlace a todas).
- **Consolidados** como renglones que se abren: checklist con ícono (listo y tachado / a medias / sin
  empezar / tarde), quién y a qué hora, y a la derecha las tarjetas de paquetes del consolidado. Cada paso
  lleva a su pantalla (desembarques, salidas a ruta, devoluciones, inventarios).
- Los consolidados terminados quedan al final, tachados y cerrados.
- Agregar al menú de Operaciones y al catálogo de permisos.

## Decisiones tomadas por mí (revisar)

- Un consolidado pertenece al día de `consolidated.date` (`charge.date` en F2). Si al día siguiente
  todavía tiene pasos pendientes, se queda en su día marcado como "tarde", y el día de hoy muestra arriba
  una franja **"Pendientes de días anteriores de esta semana"**.
- Salida a ruta: 2 h después del desembarque; si eso cae después de las 21:30 (sistema suspendido),
  vence a las 10:00 del día siguiente. Inventario inicial 10:00 y devoluciones 19:30 son valores míos
  (no estaban en la maqueta). Todo se puede cambiar por sucursal.
- Los minutos de escalamiento y el horario activo (06:00–21:30) siguen siendo generales.
- "Desembarque listo" usa el mismo porcentaje configurado (`completePct`, hoy 100%); las guías que
  faltan se listan.
- El paso de devoluciones está listo cuando todas las guías DEX del consolidado tienen devolución
  registrada o volvieron a salir a ruta.
- Las tareas del domingo se muestran igual; si la sucursal no trabaja ese día, aparece vacío.
- La pantalla funciona siempre; los avisos respetan el interruptor general de alertas (`enabled`) y los
  pasos activables por sucursal, que también aplican al inventario inicial y a las devoluciones.
- Los avisos van a los mismos destinatarios que ya usa `ops-alerts`: usuarios de la sucursal, encargados
  (`managerUserIds`) y grupos o números de WhatsApp configurados.

## Queda a criterio de quien lo construya

- Partir el cálculo en funciones puras con pruebas (como `computeSteps`) y SQL agrupado por lote, sin
  consultas por guía.
- Nombres exactos de componentes y archivos, siguiendo lo que ya hay en `ops-alerts` y `operaciones/`.
- Cómo paginar las listas largas de guías (DataTable con filtros del lado del servidor, si se necesita).

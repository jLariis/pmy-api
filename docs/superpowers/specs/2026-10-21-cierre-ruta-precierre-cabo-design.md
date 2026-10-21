# Cierre de ruta con pre-cierre y comprobación (piloto Cabo San Lucas)

Fecha: 2026-10-21 · Repos: pmy-api + app-pmy

## Por qué

En Cabo San Lucas el cierre real se hace en papel: el chofer entrega la hoja "Paquetería y Mensajería
Delyaqui" (devoluciones con DEX, recolecciones, cash, resumen y firma). Hoy el sistema no compara esa
hoja con lo que tiene, y cuando el chofer reporta algo distinto no hay forma de corregirlo en el cierre
ni de dejar rastro. Queremos: 1) que el sistema imprima esa misma hoja (pre-cierre) antes de cerrar,
2) comprobar guía por guía contra lo que dice el chofer y corregir el estatus ahí mismo, 3) que cada
corrección quede auditada.

## Alcance

- Solo sucursales con el flag nuevo encendido (al inicio solo Cabo San Lucas). Las demás siguen con el
  diálogo actual (`close-package-dispatch-form.tsx`) sin ningún cambio.
- Fuera de alcance: migrar las demás sucursales, cambiar el PDF/Excel de cierre que se manda por correo,
  cambiar el flujo de recolecciones/No VAN (se reutilizan tal cual).

## Configuración

- Columna nueva `subsidiary.routeClosureWithPreClosure` (boolean, default false).
- Migración 115 la agrega y la enciende en Cabo San Lucas (id `abf2fc38-cb42-41b6-9554-4b71c11b8916`).
- Switch en Configuración → sucursal (`subsidiary-config-panel.tsx`, arreglo `FLAGS`):
  "Cierre en pantalla completa con pre-cierre".
- Es una configuración normal de sucursal: se puede encender o apagar en cualquier momento y para
  cualquier sucursal desde esa pantalla, sin migración ni despliegue. Por defecto, al salir, solo
  Cabo San Lucas queda encendida; todas las demás apagadas.
- El cambio aplica la siguiente vez que se abre un cierre (la decisión se toma al presionar el
  candado). Un cierre que ya está abierto en pantalla termina con el flujo con el que empezó.

## Entrada

En Salidas a ruta (`package-dispatch-control.tsx`), el botón del candado:
- flag apagado → abre el diálogo actual;
- flag encendido → navega a `app/operaciones/salidas-a-ruta/[id]/cierre/page.tsx` (también el query
  param `cerrar` respeta el flag).

La pantalla es un componente nuevo (`components/route-closure-v2/…`), dentro de
`AppLayout` + `withAuth("operaciones.salidasARutas")` + `OperationHeader`, solo shadcn + Tailwind, UI
densa (un renglón por guía). Acciones fuertes (Generar pre-cierre, Siguiente, Cerrar ruta) en el header.
Al montar hace lo mismo que el diálogo: `reconcile(dispatchId)` y luego `getShipmentsByDispatchId`.

## Paso 1 · Pre-cierre (obligatorio)

- Totales y tarjetas iguales a hoy (entregados / no entregados / ocurre / otros) con los mismos candados
  (`isClosureBlockedByOtherStatus`, `allowRouteClosureWithOtherStatus`, panel de superadmin).
- Botón **Generar pre-cierre** → PDF con `@react-pdf/renderer` lo más idéntico posible a la hoja manual:
  encabezado (empresa, ciudad de la sucursal, chofer, fecha de la ruta, ECO/unidad, KM salida del
  sistema, KM llegada en blanco); tabla DEVOLUCIÓN (guía + DEX) con las guías no entregadas del sistema;
  tabla RECOLECCIÓN en blanco; tabla CASH (T.C., $, guía) con los cobros contra entrega de la ruta;
  resumen (recibidos, devueltos, DEX-03, DEX-07, DEX-08, DEX-12, recolecciones, entregas efectivas);
  observaciones y firma de recibido. Si hay más de 20 devoluciones, la tabla continúa en otra hoja.
- **Guías en riesgo de LD (Local Delay)**: el pre-cierre marca cada guía no entregada con una o
  varias señales:
  - **Sin movimiento**: no tuvo ningún evento FedEx/DHL en el día de la ruta.
  - **Vence hoy**: su fecha de vencimiento (Hermosillo) es el día de la ruta.
  - **Posible LD / LD**: resultado de la regla única `classifyLd` (`src/common/ld-rule.util.ts`), con
    la variante de Salidas a ruta (`requireNoMovement: false`: solo un DEX válido del día de
    vencimiento, `LD_QUALIFYING_EXCEPTION_CODES`, quita el riesgo). Así cuadra con los reportes y
    Tareas del día.
  En el PDF: sección "Guías con riesgo de LD" antes del resumen (guía, destinatario, vence, señales),
  y en la tabla de devoluciones una marca junto a la guía. En pantalla: tarjeta "Riesgo de LD" con el
  conteo en el Paso 1, y en el Paso 2 una columna de señales (pastillas) más el filtro "Riesgo de LD"
  (Sin movimiento / Vence hoy / Posible LD). Solo informa; no bloquea el cierre. El back calcula las
  señales en el endpoint de carga de la pantalla (no se duplica la regla en el front).
- "Siguiente" queda bloqueado hasta generar el PDF. Se guarda en memoria la hora de generación
  (se re-genera si se recarga la página) y viaja al cerrar como `preClosureGeneratedAt`.

## Paso 2 · Comprobación con el chofer

- Pestañas: Todos · POD · DEX · Otros · Recolecciones · No VAN (estas dos, igual que hoy con
  `ScanInput` y sus `storageKey`).
- Tabla con el `DataTable` del proyecto y sus filtros predefinidos (toolbar + faceted filter):
  buscar guía, paquetería (FedEx / DHL), estatus, "solo cambiados", limpiar; contador "X de Y guías".
- Columnas: #, guía, paquetería, destinatario, estatus en sistema, selector "según el chofer".
  FedEx: Entregado, DEX03, DEX07, DEX08, DEX12, Ocurre. DHL: sus códigos actuales (OK/NH/BA/RD/CM, del
  catálogo `dhl_status`); la confirmación DHL obligatoria de hoy se conserva dentro de esta tabla.
- Al cambiar un estatus: renglón resaltado, la guía cambia de pestaña (vía `classifyClosureBucket`),
  sube el contador de cambios. Nada se guarda hasta "Cerrar ruta".
- **Aviso entregado → DEX**: si la guía es paquete (no `charge_shipment`) y la ruta no es F2/31.5, y ya
  tiene ingreso ENTREGADO vivo, al elegir DEX aparece confirmación: "Esta guía ya tiene un ingreso
  generado. Si continúas, ese ingreso se anula." Cancelar regresa al estatus anterior. Para saberlo, el
  endpoint de carga de la pantalla devuelve `hasDeliveredIncome` por guía.

## Paso 3 · Finalizar

Kilometraje de llegada, lista de cambios manuales (guía · antes → después) y **Cerrar ruta**.

## Qué se guarda al cerrar (una sola transacción, dentro de `routeclosure.create`)

El payload actual se mantiene y se agrega `manualStatusChanges: [{ id, isCharge, trackingNumber,
previousStatus, newStatus, exceptionCode }]` y `preClosureGeneratedAt`. Se valida en el back que cada
id pertenezca a la ruta y que `previousStatus` coincida con el actual (si no, se rechaza con mensaje
en llano: "La guía X cambió mientras cerrabas; recarga la pantalla").

Por cada cambio manual:
1. Actualiza `shipment.status` / `charge_shipment.status`.
2. Inserta `shipment_status` (estatus, `exceptionCode`, `timestamp` = hora del cierre en el día de la
   ruta, `notes` = motivo automático) con columna nueva `source = 'route_closure_manual'`
   (nullable; los demás orígenes quedan NULL).
3. Inserta en tabla nueva `route_closure_manual_status`: id, routeClosureId, shipmentId /
   chargeShipmentId, trackingNumber, previousStatus, newStatus, exceptionCode, reason, createdById,
   createdAt. (Mismo espíritu que `shipment_not_in_files` para No VAN.)
4. Ingresos:
   - **→ Entregado** (paquete, ruta no 31.5): genera ingreso ENTREGADO por las reglas actuales
     (`charge_rule`, día de la ruta). No duplica: se usa el mismo antiduplicado del motor
     (un ingreso por shipment+semana; si existe un NO_ENTREGADO se sube a ENTREGADO). Cargas y rutas
     F2/31.5 no generan ingreso por paquete.
   - **Entregado → DEX** (paquete, confirmado): anula el ingreso ENTREGADO con el mismo mecanismo de
     devoluciones (`annulEntregadoIncomeFor`: soft-anular + reversa −cost + audit). Después, si el DEX
     es cobrable según `charge_rule` (p. ej. DEX08 3ª visita), se crea su ingreso como hoy en el cierre.
5. Motivo automático (`reason` y `notes`), p. ej.:
   "Cambio manual en cierre de ruta por {usuario}: guía {guía} de {antes} a {después}. Ruta {folio}
   del {fecha}, chofer {chofer}."

Además `route_closure.preClosureGeneratedAt` (nullable).

## FedEx después del cierre

Decisión del usuario: como nosotros ponemos el estatus y la historia, el cron verá el mismo estatus y no
lo cambia. Verificado: el motor ya trae `terminal-lock` (entregado / devuelto son finales) y el
antiduplicado de ingresos por shipment+semana. No se agrega regla nueva.

## Migraciones

115: `subsidiary.routeClosureWithPreClosure` + encender Cabo San Lucas;
`shipment_status.source`; tabla `route_closure_manual_status`; `route_closure.preClosureGeneratedAt`.
Todo por migración (DB_SYNC=false).

## Pruebas

- Back (jest): cambio a entregado crea un solo ingreso aunque el cron corra después; entregado→DEX
  anula y crea reversa; cargas/31.5 sin ingreso; rechazo si `previousStatus` no coincide; motivo
  generado.
- Front (vitest): reclasificación de pestaña al cambiar estatus; filtros; bloqueo de "Siguiente" sin
  pre-cierre; aviso de ingreso existente solo para paquetes fuera de F2/31.5; filtro de riesgo LD.
- Back (jest): señales de LD por guía (sin movimiento, vence hoy, posible LD) coinciden con
  `classifyLd`.
- Navegador: recorrido completo en Cabo San Lucas y verificación de que otra sucursal sigue con el
  diálogo.

## Decisiones mías (revisar)

- Nombre del flag y ruta de la pantalla.
- Hora del renglón de `shipment_status`: hora del cierre dentro del día de la ruta.
- La hora de generación del pre-cierre no se persiste hasta cerrar (coherente con "nada se guarda en
  tiempo real").
- DEX cobrable después de anular un entregado: se cobra según `charge_rule` como cualquier cierre.

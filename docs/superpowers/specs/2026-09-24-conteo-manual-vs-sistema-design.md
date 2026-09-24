# Conteo manual vs sistema (Consolidador) — diseño

Fecha: 2026-09-24 · Repos: pmy-api + app-pmy · Rama: `feat/conteo-manual` (pmy-api parte de `fix/dex08-route-closure`)

## Problema

El conteo manual de paquetes (POD / DEX07 / DEX08) que hacen los usuarios casi nunca cuadra
con el sistema. Hoy cada descuadre se investiga a mano (SQL + FedEx + código), como el caso
Hermosillo 22-09 (540148275693 / 877368113055 cobrados como DEX08 sin 3 visitas). Queremos una
herramienta que haga ese análisis sola y, cuando encuentre errores del sistema, genere un
prompt listo para pegar en Claude Code y corregirlos.

## Alcance

- Nueva pestaña **"Conteo manual"** en Finanzas → Consolidador. **Solo superadmin**
  (`GLOBAL_ROLES`: superadmin/superamin/owner): la pestaña se oculta al resto y el backend lo
  exige también.
- Solo FedEx de envío (shipment) y guías F2/carga (charge_shipment) informativas. DHL fuera.
- Sucursal: la del header del Consolidador. **Día**: selector de día dentro de la pestaña
  (default: hoy, acotado a la semana del header).
- No se guarda nada: el análisis se corre bajo demanda. Se exporta a Excel.
- Read-only: la herramienta NO corrige datos (ni anula ingresos). Solo diagnostica y genera prompt.

## Entrada

1. **Tres cajas de pegado**: POD, DEX07, DEX08. Una guía por línea (o columna pegada de Excel);
   se limpian espacios, se quitan duplicados y se marca una guía que aparezca en 2 cajas.
2. **Subir Excel** (`xlsx`, ya en app-pmy) que llena las cajas; acepta dos formatos:
   - 3 columnas con encabezados `POD | DEX07 | DEX08` (variantes: `DEX 07`, `07`, `ENTREGADO`).
   - 2 columnas `Guía | Estatus` con estatus POD/ENTREGADO/07/DEX07/08/DEX08.
   Encabezados no reconocidos → mensaje en llano; el usuario revisa las cajas antes de comparar.

## Universo de guías

Contadas por el usuario ∪ guías del sistema de esa sucursal y día con: ingreso activo de envío
con `date` en el día, o evento de desenlace (entregado/rechazado/07/08) en el día, o en una
`package_dispatch` con `routeDate` en el día. "Día" = día local Hermosillo (espejo de
`income-window.util`).

## Cadena de validaciones (por guía; se detiene en el primer eslabón roto = causa)

| # | Validación | Fuente | Causa si se rompe |
|---|---|---|---|
| 1 | Existe y es de la sucursal (o traspaso hacia ella) | `shipment` / `charge_shipment`, `package_transfer` | `NO_EXISTE` / `OTRA_SUCURSAL` |
| 2 | Nos la dieron: consolidado registrado con fecha ≤ día | `consolidated` (shipment.consolidatedId) / carga F2 | `SIN_CONSOLIDADO` |
| 3 | Salió a ruta (historial, no la relación viva) | `package_dispatch_history` + `package_dispatch` | `SIN_RUTA` |
| 4 | Mismo día: `routeDate` (día Hermosillo) = día del desenlace FedEx que se cobra | ruta vs evento FedEx | `RUTA_OTRO_DIA` |
| 5 | FedEx en vivo (siempre): desenlace del día + todos sus 08 | `FedexService.trackPackage` + selección de generación (UniqueID) igual al cierre | `ESTATUS_DESFASADO` (nuestro estatus ≠ FedEx) |
| 6 | Reglas de cobro (las reales, reutilizadas) | ver abajo | `REGLA_NO_COBRA` / `DEBE_COBRAR` |
| 7 | Lo cobrado: ingreso activo, del día correcto, sin duplicar, monto correcto | `income` | `COBRO_DE_MAS` / `COBRO_FALTANTE` / `INGRESO_OTRO_DIA` / `DUPLICADO` / `MONTO_INCORRECTO` |
| 8 | Lo que contó el usuario vs el veredicto de 5–6 | lista manual | `ERROR_CONTEO` |

`COBRO_FALTANTE` lleva subcausa cuando se puede inferir: nunca salió a ruta, ruta sin cierre,
ruta 31.5, carga F2 (cobro agrupado), ingreso anulado por devolución.

**Reglas de cobro del paso 6** (se llama al código existente, no se copia):
- `charge_rule` por carrier + código (global + override sucursal) vía `ChargeRulesService` /
  `ChargeableResolver` + `isCountableIncome`.
- Ruta 31.5 (`package_dispatch.is315`): no cobra por guía.
- F2/carga: cobro agrupado de la carga, no por guía → informativo.
- DEX08: 3 días distintos con 08 en la misma semana ISO (`hasWeekWithThreeDex08Days`).
- Entregado gana a DEX del mismo día; una guía no cobra 2 veces el mismo desenlace.
- Devolución anula el ingreso de entregado (`income.active=0`).
- Entregado en bodega (pick-up) sí genera ingreso ENTREGADO.
- Costo = `subsidiary.fedexCostPackage`.

**Veredicto por guía**: `CUADRA` · `ERROR_SISTEMA` (pasos 1–7) · `ERROR_CONTEO` (solo 8) ·
`REGLA` (el usuario espera un cobro que la regla no permite, p. ej. DEX08 con 2 visitas).

## Backend (pmy-api, módulo consolidador)

- `logic/manual-count-diagnose.util.ts` — **puro**. Entrada: por guía `{ manual, facts }` donde
  `facts` = existencia/sucursal, consolidado, rutas (folio, routeDate, is315, cerrada), eventos
  del sistema, FedEx en vivo (desenlace, fecha, 08s), ingresos, reglas resueltas, costo. Salida:
  `{ trackingNumber, manual, fedex, system, charged, verdict, cause, subCause, explanation, evidence }`.
- `logic/manual-count-prompt.util.ts` — **puro**, determinista (patrón de `support/prompt-builder`):
  arma Markdown con contexto (sucursal, día, totales manual/FedEx/cobrado), una sección por causa
  de sistema seleccionada con hasta 10 guías de evidencia, **mapa causa → archivos/funciones
  sospechosas** (constante en el util), reglas del proyecto (migraciones, DB_SYNC=false, pruebas,
  nunca borrar ingresos: anular con `active=0`) y criterios de aceptación. Los `ERROR_CONTEO`
  no entran al prompt.
- `audit/manual-count.service.ts` — junta los hechos por lotes (queries con `IN`), llama FedEx
  con concurrencia 8 y caché en memoria (TTL 15 min por guía), delega al util.
- Endpoints (guard del consolidador + chequeo superadmin):
  - `POST consolidador/:subsidiaryId/manual-count/fedex` body `{ trackingNumbers[] ≤ 25 }` →
    precalienta la caché FedEx; el front lo llama por bloques para mostrar progreso.
  - `POST consolidador/:subsidiaryId/:date/manual-count` body `{ pod[], dex07[], dex08[] }` →
    diagnóstico completo (usa la caché; lo que falte lo consulta).
  - `POST consolidador/:subsidiaryId/:date/manual-count/prompt` body `{ rows, causes[] }` → texto.
- FedEx caído para una guía → paso 5 marcado "sin respuesta de FedEx" y se sigue con datos del
  sistema; nunca rompe el análisis.

## Frontend (app-pmy)

`components/consolidador/manual-count-panel.tsx` (+ subcomponentes), solo shadcn + Tailwind:
- Arriba: selector de día, 3 `Textarea` con contador, botón "Subir Excel", botón "Comparar".
- Progreso "Consultando FedEx… 120/200".
- Resumen en tarjetas: contado vs FedEx vs cobrado por POD/07/08, y conteo por veredicto.
- `DataTable` con filtros por veredicto/causa: guía, contó, FedEx dice, sistema, cobrado, causa y
  explicación en llano; fila expandible con la cadena de validaciones (✓/✗ por eslabón).
- "Generar prompt" (elige causas) → diálogo con el texto, Copiar y Descargar `.md`.
- "Exportar Excel" (exceljs).
- Textos en lenguaje simple; códigos de dominio permitidos (DEX07, consolidado, F2).

## Pruebas

- Jest del util de diagnóstico con casos reales: 540148275693 (1 visita → `COBRO_DE_MAS`),
  877368113055 (2 visitas), POD sin ruta, ruta de otro día, ruta 31.5, F2, devolución anulada,
  error de conteo, otra sucursal, duplicado, FedEx caído.
- Jest del prompt: incluye causas elegidas, excluye `ERROR_CONTEO`, determinista.
- Vitest del parseo (cajas + 2 formatos de Excel, duplicados, guía en 2 cajas).
- Verificación en navegador con Hermosillo 22-09.

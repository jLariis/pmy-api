# Dashboard Ejecutivo: conteos por sucursal operativa (fan-out de bodegas)

**Fecha:** 2026-09-01
**Repos:** `pmy-api` (backend). Sin cambios en `app-pmy` (el contrato `SubsidiaryMetrics` se conserva).
**Estado:** diseño aprobado.
**Antecede:** `2026-08-29-dashboard-counts-from-consolidados-design.md` (que re-ancló el dashboard a consolidados).

## 1. Problema

El rediseño previo ancló los conteos del Dashboard al **consolidado**, agrupando por
`consolidated.subsidiary`. Pero una **bodega** (`subsidiary.isWarehouse = true`, ej. Bodega Obregón,
Bodega Hermosillo) recibe un consolidado y lo **reparte a varias sucursales satélite**
(Huatabampo, Navojoa, Álamos, Vícam, Guaymas, Pueblo Yaqui, Villa Juárez; Caborca, Puerto Peñasco…),
y además **entrega parte desde sus propias rutas**.

Como el conteo llavea por el consolidado (cuyo dueño es la bodega):

- El **total declarado** (`SUM(numberOfPackages)`) cae 100% en la bodega.
- El **desglose** (entregado/DEX/en_ruta/F2) se agrega **solo por `s.consolidatedId`**
  (`consolidated.service.ts` `findAll`), **sin mirar nunca `shipment.subsidiary`**.

Resultado: la bodega se **infla** (declara y "entrega" todo) y las satélites aparecen en **0**, aunque
ellas hagan la entrega real. El regreso de excedentes (sucursal→bodega) tampoco se refleja.

Volver al conteo anterior **no es opción** (esos conteos no eran reales). Se mantiene el ancla a
consolidados; lo que cambia es **a quién se le atribuye** cada guía.

## 2. Decisión

El Dashboard pasa a contar por **sucursal operativa** — quién opera la guía **hoy** — usando
`shipment.subsidiary` / `charge_shipment.subsidiary`. Esta señal ya la mantienen al día los traspasos
en **ambos sentidos**:

- **Salida bodega→sucursal:** `warehouse_outbound` tipo `TRANSFER` reasigna `subsidiary` al destino
  (confirmado por el rollback que restaura `subsidiary = originId`).
- **Corrección de mal enrutamiento:** `PackageTransferService.create()` cambia `shipment.subsidiary`
  (y `charge_shipment.subsidiary`) al destino.
- **Regreso de excedentes:** es un traspaso inverso → `subsidiary` vuelve a la bodega.

Dos granos separados **a propósito**:

- **Consolidado = intake de la bodega** → pantalla de Consolidados, **sin cambio**.
- **Operación = quién opera la guía** → Dashboard, **nuevo grano**.

### Decisiones confirmadas con el usuario

- **Total = conteo real por sucursal operativa, COMBINANDO `shipment` + `charge_shipment`.**
  `totalPackages(sucursal)` = # de guías (normales **y** cargas F2) cuyo `subsidiary` es esa sucursal,
  ancladas a consolidados del periodo. (Las cargas cuentan **junto** con las guías en el total y el
  desglose, igual que el motor viejo `findAll`: `total = shipments + F2`. `totalCharges` sigue siendo el
  # de cargas como indicador aparte.) Se **abandona** el denominador "declarado" puro a nivel de
  sucursal.
- **Remanente declarado sin distribuir → al DUEÑO (bodega), como "en proceso".** Por consolidado,
  `remanente = numberOfPackages declarado − guías ya ligadas (shipment + charge_shipment activas)`. Se
  atribuye a la bodega dueña: son paquetes que llegaron y están físicamente en la bodega, aún sin
  escanear/repartir. Así un consolidado recién creado **muestra su intake de inmediato** (no aparece en
  0) y, conforme se escanea, el conteo se mueve a las sucursales operativas y el remanente baja. Suma a
  `totalPackages` y a `inProcessPackages` para conservar el cuadre.
- **Cuadre exacto:** `entregado + dex + enProceso + otros = totalPackages` por sucursal.
- **Alcance: solo Dashboard.** La pantalla de Consolidados sigue mostrando por consolidado.
- **`consolidations` se mantiene por dueño del consolidado** (la bodega). Una satélite que solo recibe
  traspasos tendrá `consolidations = 0` pero `totalPackages > 0`. Es correcto e informativo.
- **Financieros sin cambio** (`Income`/`Expense` ya llavean por su propio `subsidiaryId`).

> **Nota de implementación (2026-09-02):** la primera versión contaba **solo `shipment`** en
> `totalPackages` y excluía las cargas, lo que dejaba en **0** a los consolidados cuyas guías viven en
> `charge_shipment` (F2) — p.ej. un consolidado "ordinario" con 40 cargas y 0 shipments se veía vacío.
> Se corrigió a conteo **combinado** shipment+charge, y se añadió el **remanente declarado** para
> recuperar la visibilidad del intake del día.

## 3. Alcance

- **Backend:** `src/dashboard/kpi.service.ts` (`getSubsidiariesKpis`) y un **método nuevo** en
  `src/consolidated/consolidated.service.ts`. `findAll` queda **intacto**.
- **Frontend:** **ninguno.** `SubsidiaryMetrics` se conserva idéntico; solo cambian los números.

## 4. Arquitectura

### 4.1 Nuevo método `ConsolidatedService.getOperationalCountsBySubsidiary`

```
getOperationalCountsBySubsidiary(
  from: Date, to: Date,
  scope?: { subsidiaryIds?: string[] },
): Promise<Map<subsidiaryId, OperationalPackageStats>>
```

Pasos:

1. **Consolidados del periodo:** ids de `consolidated` con `date` en `[from,to]`, `active = true`
   — **SIN filtrar por dueño** (la bodega). Misma ventana UTC que hoy usa Consolidados
   (`new Date('YYYY-MM-DD')` → medianoche UTC, `[00:00:00, 23:59:59]`).
2. **Guías (`shipment`):** filas con `consolidatedId IN ids`, `active = true`,
   `status != cancelado`, **agrupadas por `shipment.subsidiaryId`**, con conteos por bucket de estatus.
3. **Cargas (`charge_shipment`):** mismo criterio, agrupadas por `charge_shipment.subsidiaryId`
   → `totalCharges` (countF2).
4. **Scope por rol (CRÍTICO):** el filtro `subsidiaryIds` se aplica sobre
   `shipment.subsidiaryId` / `charge_shipment.subsidiaryId` (operativo), **NO** sobre el dueño del
   consolidado. (De lo contrario una sucursal satélite no vería sus guías, que viven en el consolidado
   de la bodega.)

`OperationalPackageStats` por sucursal:

| Campo | Cálculo |
|---|---|
| `totalPackages` | COUNT real de `shipment` **+ `charge_shipment`** de esa sucursal (combinado) **+ remanente declarado si es dueña** |
| `deliveredPackages` | COUNT status entregado (shipment + charge) |
| `byExceptionCode.code03/07/08` | COUNT dex03/dex07/dex08 (shipment + charge) |
| `undeliveredPackages` | dex03 + dex07 + dex08 |
| `inProcessPackages` | pendiente + en_ruta + en_bodega (shipment + charge) **+ remanente declarado si es dueña** |
| `otherPackages` | total − entregado − dex − enProceso (residual ≥ 0; devueltos/ocurre/etc.) |
| `totalCharges` | COUNT `charge_shipment` de esa sucursal (indicador aparte, subconjunto del total) |

Los buckets de estatus reutilizan el mismo mapeo que hoy usa `findAll` (mismos `ShipmentStatusType`
por bucket), extraído a un helper compartido para no duplicar la clasificación.

### 4.2 `kpi.service.getSubsidiariesKpis`

- **Sustituir** el bloque que hoy llama `findAll(...summaryOnly)` + `rollupConsolidatedPackageStats`
  por una llamada a `getOperationalCountsBySubsidiary(consFrom, consTo, { subsidiaryIds })`.
- `consolidations` (ordinary/air/total) se calcula aparte, **por dueño del consolidado**: un COUNT de
  `consolidated` en el periodo agrupado por `consolidated.subsidiaryId` y `type` (respetando el scope
  por dueño para esta métrica). Reutiliza la data que ya trae `findAll` o una query ligera dedicada.
- **Financieros:** intactos (bloques `Income`/`Expense` actuales, ventana Hermosillo).
- **Merge:** por `subsidiary.id`, mismo shape `SubsidiaryMetrics` de hoy.
- `averageEfficiency = totalPackages>0 ? deliveredPackages/totalPackages*100 : 0`.
- `averageRevenuePerPackage = totalPackages>0 ? totalRevenue/totalPackages : 0`.

### 4.3 `consolidated-package-rollup.ts`

Deja de usarse en el dashboard (la agregación ya llavea por sucursal). Se conserva el archivo si algún
otro consumidor lo usa; si no tiene otros consumidores, se elimina para no dejar código muerto
(verificar referencias antes de borrar — regla del proyecto: dejar el código más limpio).

## 5. Bordes

- **Guías sin `consolidatedId`:** siguen **ignoradas** (dashboard 100% anclado a consolidados).
- **Regreso de excedentes:** `subsidiary` vuelve a la bodega → cuenta a la bodega. Natural.
- **DHL:** cada pieza es una fila (`dhlUniqueId`); se cuenta por fila.
- **Periodo:** anclado por `consolidated.date` (no `shipment.createdAt`).
- **Sucursal en scope sin guías operadas:** conteos en 0; financieros presentes.
- **Cancelados / `active = false`:** excluidos de los conteos.

## 6. Pruebas (jest, backend)

1. **Fan-out:** un consolidado de bodega con guías repartidas a 3 sucursales (vía `shipment.subsidiary`
   distinto) → cada sucursal recibe su conteo; la bodega solo lo que retuvo. Total por sucursal = # de
   sus filas.
2. **Scope operativo:** filtrar por una sucursal satélite devuelve sus guías **aunque** el consolidado
   sea de la bodega (no de la satélite).
3. **Regreso de excedentes:** guía con `subsidiary` vuelto a la bodega cuenta a la bodega, no a la
   satélite.
4. **Cargas F2:** `charge_shipment` atribuidas por `charge_shipment.subsidiary`.
5. **Eficiencia:** `deliveredPackages/totalPackages`, ambos reales por sucursal operativa.
6. **Cuadre:** `entregado + undelivered + inProcess + other == totalPackages` por sucursal.

Regla del proyecto: dejar `tsc` y lint limpios en los archivos tocados, y resolver **todos** los
errores que aparezcan en ellos.

## 7. No-objetivos / YAGNI

- No se cambia la pantalla de Consolidados (sigue por consolidado / intake).
- No se re-anclan los ingresos (financieros sin cambio).
- No se parte el consolidado ni se reasigna `consolidatedId` en los traspasos.
- No se crea un cubo "Sin consolidar".
- No se cambia la UI del dashboard ni el contrato `SubsidiaryMetrics`.

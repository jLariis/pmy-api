# Auditoría — Cabo San Lucas: conteo manual vs sistema (12 al 17 de octubre de 2026)

**Fecha:** 19-oct-2026 · **Alcance:** 70 guías reportadas en la revisión manual · **Fuentes:** base de datos (respaldo de producción del 19-oct), FedEx Track API en vivo (19-oct), bandeja de correos FedEx, bitácora (`audit_log`), archivos de importación (`import_file`) y código de `pmy-api` (`main`, commit `f799cab`).

Tarifa de Cabo: **$122 por paquete**; carga F2: **$4,878** ($5,472 con 2º a bordo).

---

## 1. Resumen ejecutivo

| # | Hallazgo | Guías | Efecto en ingreso | Tipo de causa |
|---|---|---|---|---|
| A | Dos archivos de FedEx (“salida carlos”) **nunca se subieron**; las guías se entregaron sin existir en el sistema | 31 | **−$3,782** (no cobrado) | Operación + bandeja |
| A′ | Devolución capturada sobre el **registro equivocado** → la guía entregada quedó “devuelta” | 1 | **−$122** | Operación + regla vieja |
| C | Las guías de cada **F2 también entraron como paquete** en el master del mismo día → cobran $122 c/u **además** de la carga | 23 (+7 por verificar) | **+$2,806** (+$854 por verificar) | Sistema + operación |
| D/E | **Ocurre / recogidas en FedEx** se cobraron como si las hubiéramos entregado | 6 | **+$732** | Sistema |
| B | Rechazo 07 y entrega de la **misma guía en la misma semana**, en dos consolidados → cobró las dos | 1 | **+$122** | Sistema |
| F | **POD por error**: FedEx tiene la entrega registrada | 1 | **+$122** | Operación (chofer / FedEx) |

**Neto:** faltan **$3,904** por cobrar y sobran **$3,782** cobrados de más (+$854 por verificar): diferencia neta de solo **−$122**. El total del periodo casi “cuadra” por casualidad, pero **las dos mitades están mal** y el desglose por día y por guía no coincide con la realidad.

Además se detectaron: **3 rutas abiertas** (sin cierre), cierres de ruta hechos **4–14 días tarde**, y que las cargas F2 **no guardan quién las subió**.

---

## 2. Personas que intervienen

| Persona | Papel en estos casos |
|---|---|
| **Maria Manzanilla** (`mariamanzanilla@…`, “Maria” en importaciones) | Sube los master (“Pegar FedEx”) y las F2 de carga diarias |
| **Marisol Villegas** (`marisolvillegas@…`) | Sube master aéreo y valor; **crea todas las salidas a ruta**; captura devoluciones; alta manual de 878685371094 |
| **Alberto Gutiérrez** (`albertogutierrez@…`) | **Cierra todas las rutas** de Cabo |
| Wendy Isamar Miranda (FedEx) | Envía los archivos “salida yaqui / salida aérea” |
| Jose Gaxiola / Luis Leonardo Torres (FedEx) | Envían los archivos de carga (“CARGA YAQUI CABO”), que traen la hoja F2 |

> Nota: en varios hallazgos la causa principal es del **sistema** (reglas de cobro), no de una persona. Se marca en cada caso.

---

## 3. Hallazgos detallados

### A. “Entregadas que el sistema no tiene” — 31 guías nunca se subieron

**Qué pasó.** FedEx confirma que **las entregamos nosotros** (escaneo 67 “On the way” = proveedor de confianza, después “Delivered”), pero **ninguna existe en la base**: ni como paquete ni como carga, en ninguna sucursal.

Vienen de **dos correos de FedEx que se quedaron sin subir**:

| Correo | Archivo | Consolidado | Guías | Estado en la bandeja |
|---|---|---|---|---|
| Wendy Miranda, 12-oct 14:04, “SALIDA YAQUI.” | `salida carlos 12 oct.xlsx` | **305823178301** | 5 | revisión · pendiente · 0/5 en sistema |
| Wendy Miranda, 14-oct 13:00, “salida yaqui” | `salida carlos 14 oct.xlsx` | **305823833018** | 26 | revisión · pendiente · 1/26 en sistema |

Las “salida **cristian**” de esos mismos días **sí se subieron** (Maria). Las de “**carlos**” no.

- 12-oct (5): 384080073037, 878432405524, 878458879273, 878436433493, 878432489398 — 67 a las 13:27, entregadas 12–16 oct.
- 14-oct (26): 384071359449, 384072633616, 384103480115, 384108225427, 536541275859, 878347599082, 878348058854, 878392770026, 878392770037, 878396711982, 878397471508, 878403448027, 878406926091, 878409583383, 878413564406, 878414311804, 878434772555, 878462744934, 878466712474, 878467485949, 878480426248, 878482252805, 878540704814, 878612851080, 878616321457, 544322390241 — 67 a las 11:51, entregadas el 14-oct.

**Por qué.**
- **Operación (Cabo, quien sube los master: Maria Manzanilla / Marisol Villegas):** no se subió el archivo. Se salió a entregar sin que las guías estuvieran en el sistema → sin salida a ruta, sin cierre, sin ingreso.
- **Bandeja de correos:** el detector solo encontró **una pista** de sucursal (códigos postales) y lo dejó en **“revisión”**; nadie lo confirmó (`confirmedById` vacío). Ver `src/inbox/detector.ts:378-396` (pide 2 pistas para `autoSafe`) y el texto en `:383`.
- **Bug menor:** el detector vuelve a evaluar el mismo correo en cada corrida y apila una fila nueva en `inbox_detection` cada vez (mismo mensaje con 4+ filas).

**Ingreso perdido:** 31 × $122 = **$3,782**.

### A′. 383905045783 — devolución sobre el registro equivocado

| Fecha | Evento |
|---|---|
| 08-oct | Consolidado 305822480520, ruta 847441551374 → FedEx **07 (rechazo)** → ingreso 07 $122 (correcto) |
| 13-oct | Se vuelve a subir en el aéreo **305823418495** (Maria) |
| 13–15 oct | FedEx: 67 (en nuestras manos) tres días |
| **15-oct 10:36** | **Marisol Villegas** captura la devolución **con fecha 8-oct, motivo 08**, sobre el consolidado **nuevo** (305823418495) → el registro nuevo queda “devuelto a FedEx” |
| 16-oct 17:45 | FedEx: **Delivered** (lo entregamos) — el sistema ya no lo ve (estatus final) |

**Por qué.** Devolución capturada **7 días tarde**, con código distinto al de FedEx (08 vs 07) y aplicada al registro que seguía en bodega. La regla de entonces aplicaba la devolución al registro sugerido; desde el 17-oct la persona elige el registro (`src/devolutions/devolutions.service.ts:97-130`).
**Ingreso perdido:** **$122**.

### C. “Entregadas que el sistema tiene y yo no — F2” — doble registro paquete + carga

**Qué pasó.** Los archivos de carga de FedEx traen una **hoja F2**. Al pegarlos, **las guías F2 entran también como paquetes del master** y después se suben otra vez como carga F2:

| Día | Master (paquetes) | F2 (carga) | Guías repetidas | Subió |
|---|---|---|---|---|
| 14-oct | 305823283233 — 08:26 | 305823555448 — 08:28 | **7 de 7** | Maria |
| 16-oct | 305823741300 — 08:25 | 305824072785 — 08:30 | **18 de 18** (+2 también en el master 305823832434 del 15-oct) | Maria |
| 16/17-oct | 305824120276 — 17:04 | 305824467949 — 17:12 | **22 de 22** | Maria |

El **registro de paquete nunca salió a ruta**, pero el cron de FedEx le cobró **$122 por guía** al ver “Delivered”, **además** de la tarifa de la carga.

- **23 guías confirmadas** con los dos registros: 384081772437, 384081772908, 384100310117, 519751044160, 519751095789, 539871701997, 539871702000, 878182412923, 878182412934, 878258306338, 878329995652, 878330181143, 878330967266, 878391180837, 878412530721, 878466550962, 878466550973, 878466550984, 878466550995, 878468583121, 878498077147, 878537795032, 878562402196 (+ 384081772437/908 en tres registros).
- **7 por verificar** (12-oct, master 305822880896, “CABOS 12102026 2.xlsx”): 877727582068, 878282670008, 878137408608, 878281295520, 878219435281, 877727585115, 877727711575. En el sistema solo existen como **paquete** (la F2 de ese día tiene otras 8 guías). Si en el archivo de FedEx venían en la hoja F2, se clasificaron mal al subir. El archivo original está en el servidor: `uploads/imports/fedex/305822880896/`.
- **El 12-oct NO es duplicado:** “CABOS 12102026” y “CABOS 12102026 2” son dos cargas distintas (0 guías en común).

**Por qué.**
- **Sistema:** la subida del master inserta **todo** lo que trae el archivo (decisión 2026-09-04, sin candados), incluidas las guías F2 (`addConsMasterBySubsidiary`, `src/shipments/shipments.service.ts:2809`). El cron cobra cualquier entrega FedEx **aunque el paquete nunca haya salido en una ruta nuestra** (`src/shipments/shipments.service.ts:8994-9035`).
- **Operación (Maria Manzanilla):** se pegó el master completo (con la hoja F2) y luego la F2.
- **Trazabilidad:** la carga F2 **no guarda quién la subió** (`charge.createdById` vacío; `findOrCreateCharge`, `src/shipments/shipments.service.ts:1609`). Solo `import_file` dice “Maria”.

**Cobrado de más:** 23 × $122 = **$2,806** (+ 7 × $122 = $854 por verificar).

### D / E. Ocurre y recogidas en FedEx — cobradas como entrega nuestra (6 guías)

| Guía | Lo que dice FedEx | Ingreso en el sistema |
|---|---|---|
| 877728137483 | Hold at location (A13) → Ready for pickup (015A) → Delivered 12-oct | entregado $122 (12-oct) |
| 877601778973 | Ready for recipient pickup → Delivered 13-oct | entregado $122 (13-oct) |
| 878401272928 | Ready for pickup → **Delivered 005, “FedEx Location”** 14-oct | entregado $122 (14-oct) — código **“DL”** |
| 877919889907 | Hold at location (A13) → Ready for pickup → Delivered 14-oct | entregado $122 (14-oct) |
| 877947016987 | Ready for recipient pickup → Delivered 15-oct | entregado $122 (15-oct) |
| 878265002851 (“fue devolución”) | DEX 03 13-oct → **Delivered “FedEx Location”** 14-oct | entregado $122 (14-oct) |

**Por qué (sistema):**
- El cron trata cualquier “Delivered” sin código como **ENTREGADO** y lo cobra, sin distinguir que el cliente lo recogió en FedEx (`src/shipments/shipments.service.ts:8956-9010`).
- En 878401272928 el evento traía **005** (que el cron sí trata como “entregado por FedEx”), pero el **respaldo por encabezado** (“Safety net”) lo cobró de todos modos con código “DL” (`src/shipments/shipments.service.ts:9038-9063`), porque Cabo tiene apagado “Rastrear entrega FedEx” (`trackFedexExternalDelivery`).

**Cobrado de más:** 6 × $122 = **$732**.

### B. 878465834545 — rechazo y entrega en la misma semana, cobró los dos

| Fecha | Evento | Ingreso |
|---|---|---|
| 12-oct | Aéreo 305823353380 (Marisol), ruta 094589999301 | — |
| 13-oct 17:55 | FedEx **07** | no_entregado 07 **$122** |
| 14-oct | Devolución motivo 07 (Marisol) | — |
| 15-oct | Aéreo 305823705004 (Maria), ruta 004955966905 → **Delivered** 18:04 | entregado **$122** |

**Por qué (sistema):** el candado “misma pieza en otro consolidado” solo compara el **mismo tipo** de ingreso (`siblingIncomesSinceCreated(... { incomeType })`, `src/shipments/shipments.service.ts:3307`): un 07 en un registro no impide un entregado en otro en la misma semana.
**Cobrado de más (según tu criterio):** **$122**.

### F. 878685371094 — POD por error

- Alta **manual** (sin consolidado) por **Marisol Villegas** el 15-oct; rutas 995804642854 (15-oct) y 846488753096 (16-oct).
- FedEx: 67 y **DEX 08** el 15-oct; **Delivered 16-oct 15:23, “Receptionist/Front Desk”**.
- El sistema cobró **$122** porque FedEx tiene la entrega. Si fue un POD por error, el error está en el escaneo de FedEx (chofer de la ruta 846488753096) y hay que corregirlo con FedEx; el sistema actuó con el dato que recibió.

---

## 4. Hallazgos de proceso

| Hallazgo | Detalle |
|---|---|
| Rutas sin cerrar | 549818629747 (12-oct, 40 guías), 346829562832 (14-oct, 14), 050467396705 (16-oct, 31) — todas “En progreso” |
| Cierres tardíos | Alberto Gutiérrez cerró 465133128349 (3-oct) y 847441551374 (8-oct) el **17-oct**; 863636446432 y 519215695670 el **19-oct** |
| Bandeja sin atender | Dos correos de FedEx en “revisión” 5 y 7 días sin confirmar |
| F2 sin autor | `charge.createdById` vacío en todas las F2 |

---

## 5. Recomendaciones

**Operación (Cabo)**
1. Subir **todos** los archivos de “salida” de FedEx (cristian **y carlos**, aéreo y valor) antes de armar salidas; revisar a diario la bandeja en “revisión”.
2. Al pegar una carga, **no incluir la hoja F2 en el master**; la F2 va solo como carga.
3. Capturar devoluciones **el mismo día** y con el código que reporta FedEx, eligiendo el registro correcto.
4. Cerrar rutas el mismo día o al siguiente.

**Sistema (propuestas, requieren tu decisión)**
1. **No cobrar por paquete una guía que también es carga F2** (o avisar al pegar el master que trae guías F2).
2. **No cobrar entregas en ubicación FedEx** (Hold at location / Ready for pickup / 005) ni por el respaldo de encabezado.
3. Un solo cobro por guía y semana entre registros (07 vs entregado), si esa es la regla.
4. Alerta en la barra cuando un correo de FedEx lleve más de X horas en “revisión”.
5. Guardar `createdById` al crear la carga F2.
6. Que el detector no apile una fila nueva por cada corrida del mismo correo.

**Correcciones de datos (desde el Consolidador, con autorización)**
- Dar de alta / cobrar las 31 guías de A (subiendo los dos archivos) y 383905045783.
- Anular los 23 cobros de paquete de las guías F2 (y las 7 si se confirma), los 6 de ocurre / recogida en FedEx, el duplicado de 878465834545 y, si se confirma, 878685371094.

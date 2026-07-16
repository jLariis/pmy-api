# Inventario de Documentos — Contrato de Paridad (Motor de Plantillas)

> Referencia durable para la Fase 3. Lista TODOS los documentos que hoy genera el sistema (correos, PDFs, Excels), en backend y frontend, con el detalle necesario para recrearlos como plantillas **idénticas** al diseño actual. Generado de dos inventarios exhaustivos (backend `pmy-api`, frontend `app-pmy`) el 2026-07-15.

Paleta institucional (reusar en el Branding por defecto): naranja título `#ef883a`, café encabezados `#8c5e4e` / `#6d4c41` / `#9d5137`, gris alterno `#F2F2F2` / `#F8F9FA`, amarillo pago `#fff2cc`, rojo vence-hoy `#ffe6e6`, rojo error `#FF0000`, primario PDF `#8c5e4e`. Zona horaria `America/Hermosillo`. Logo frontend: `/logo-no-fondo.png`.

---

## A) CORREOS (12) — `src/mail/mail.service.ts` + `src/auth/email.service.ts` + notificaciones

Ya sembrados en Fase 1 como MJML (`src/documents/seeds/email-templates.seed.ts`). En Fase 3 se **re-siembran como bloques**. Códigos: `route_dispatch`, `unloading`, `route_closure`, `inventory_report`, `devolutions`, `dex03_report`, `high_priority_shipments`, `unloading_priority_packages`, `inventory_priority_packages`, `password_reset_otp`, `password_reset_link`, `generic_notification`. Variables por correo: ver el seed de Fase 1 (contrato de variables ya definido).

---

## B) DOCUMENTOS GENERADOS EN EL BACKEND (9 = 8 Excel + 1 PDF)

Motores actuales: `exceljs` (Excel), `pdfmake` (PDF). Sin QR/códigos de barras. **En Fase 3: presentación por plantilla; datos/lógica en código.**

### B1. `warehouse_dispatch_pdf` (PDF)
- Origen: `src/warehouse/warehouse.service.ts:1213` `generatePdfBuffer(header, packages)`; texto saneado con `toPdfSafe()` (Latin-1).
- Documento: LETTER **landscape**, márgenes 20, Helvetica 8. Título `header.title` (Entrada a Bodega / Traspaso / Salida a Ruta).
- Secciones: (1) cabecera 2-col: título 16pt `#8c5e4e` + Fecha/Hora; (2) grid 4 celdas `SUCURSAL / VEHÍCULO / TOTAL PAQUETES / SEGUIMIENTO` (fondo `#f8f9fa`); (3) simbología fija `[C] CARGA/F2/31.5 - [$] PAGO - [H] VALOR ALTO - [A] AÉREO`; (4) tabla (headerRows:1, cabecera `#8c5e4e` blanca).
- Columnas estándar: `[#]`, `NO. GUIA`, `NOMBRE`, `DIRECCIÓN`, `CP`, `COBRO`, `FECHA`, `HORA`, `CELULAR`, `FIRMA` (anchos [20,65,100,140,30,50,50,40,60,80]).
- **Variante Hermosillo** (subsidiary.name contiene "hermosillo"): **quita `HORA`** → anchos [20,65,120,160,30,50,50,60,85].
- Fila: índice (rojo `#cc0000` bold), trackingNumber (rojo bold), recipientName, recipientAddress, recipientZip, cobro `$amount` (o N/A), commit `yyyy-MM-dd`, hora `HH:mm:ss` (no Hermosillo), recipientPhone, firma vacía. Colores fila: alternas `#f8f9fa/#fff`; con pago `#fff2cc`; vence hoy `#ffe6e6`.
- Datos: `NotificationHeader{title, subsidiary.name, vehicle.name, trackingNumber, routes[].name, drivers[].name}` + `packages[]{trackingNumber, dhlUniqueId, recipientName, recipientAddress, recipientZip, recipientPhone, commitDateTime, payment.amount/paymentAmount, isCharge}`.
- Uso: `generateAndSendWarehouseNotification` (warehouse.service.ts:699), adjunto al correo (no hay endpoint de descarga).

### B2. `warehouse_dispatch_excel` (Excel, hoja "Despacho")
- Origen: `warehouse.service.ts:1125` `generateExcelBuffer(header, packages)`.
- Fila 1 merge A:I `🚚 {title}` 16pt bold blanca, fondo `#ef883a`. Bloque texto: `Ruta:`, `Conductores:`, `Unidad:`, `Fecha: yyyy-MM-dd HH:mm`, `Paquetes:`.
- Columnas (cabecera `#ef883a` blanca centrada): `No.`, `Guía`, `Recibe`, `Dirección`, `CP`, `Cobro`, `Fecha`, `Teléfono`, `Firma` (ancho 18 uniforme).
- Fila: idx+1, trackingNumber||dhlUniqueId, recipientName, recipientAddress, recipientZip, cobro (amount si isCharge else N/A), fecha `dd/MM/yyyy`, recipientPhone, firma vacía. Mismos datos que B1.

### B3. `driver_report_excel` (Excel, 2 hojas)
- Origen: `src/package-dispatch/package-dispatch.service.ts:2762` `generateDriverReportExcel(startDate, endDate, subsidiaryId)`. Endpoint `GET /monitoring/report/drivers` (`monitoring.controller.ts:168`) → `reporte-choferes.xlsx`. (Legacy no migrar: Resp1803/2303/2303v02.)
- **Hoja 1 "Eficiencia Operativa"** (showGridLines:false): título A1:M1 `📊 REPORTE EJECUTIVO DE EFICIENCIA OPERATIVA` (16pt blanco, fondo `#0F172A`, alto 35); subtítulo A2:M2 `Periodo Analizado: {start} al {end}` (itálica `#475569`). **Cabeceras en fila 4** (fondo `#2563EB` blanca, borde medium `#1E3A8A`), columns:
  1 `Chofer / Repartidor` (driverName, w32) · 2 `Total Asignados` (total, w15) · 3 `Entregados` (delivered, w14) · 4 `DEX Total` (returned, w12) · 5 `DEX 03 (Dir. Mal)` (dex03, w15) · 6 `DEX 07 (Rechazo)` (dex07, w16) · 7 `DEX 08 (No Disp.)` (dex08, w16) · 8 `Sin Movimiento` (pending, w15) · 9 `Cambio Fecha` (fechaReq, w15) · 10 `Dev. FedEx` (retFdx, w15) · 11 `Otros (Fugas)` (unmapped, w15) · 12 `% Efectividad` (pctEff, w14) · 13 `% Retorno` (pctRet, w12).
  - Formatos: cols 2-11 `#,##0`; 12-13 `0.0%` con semáforo (verde `#059669` / ámbar `#D97706` / rojo `#E11D48`; eff ≥0.90/≥0.75, ret ≤0.05/≤0.15). Filas alternas `#fff/#F8FAFC`. Fila final `TOTALES GLOBALES` (fondo `#E2E8F0`, borde double). autoFilter A4:M4.
- **Hoja 2 "Detalle de Paquetes"**: cabecera fila 1 fondo `#475569` blanca. Columns: `Chofer`(driver,25) `Ruta`(route,20) `Sucursal`(subsidiary,20) `Tracking`(tracking,22) `Estatus`(status,35) `Cód. DEX`(dex,14) `Fecha Commit`(commit,18) `C.P.`(cp,10) `Destinatario`(recipient,35). Alternas `#fff/#F8FAFC`; cols 4-8 centradas; DEX≠'-' rojo `#E11D48` bold; commit `toLocaleDateString('es-MX')` o "Sin Fecha". autoFilter A1:I1.
- Datos: agregado por chofer desde package_dispatch + history; `effectiveStatusSql`.

### B4. `income_statement_excel` (Excel, 3 hojas) — **columnas dinámicas por día**
- Origen: `src/resports/resports.service.ts:19` `generateIncomeStatementReport(subsidiaryIds, startDate, endDate)`. Endpoint `resports.controller.ts:64`.
- **Hoja 1 "Estado de Resultados"**: columns = `variable`(w40) + **una columna por día del rango** (`dateKeys`, etiqueta mes-día es-MX mayúsc, w16 c/u) + `total`(w22). Título fila1 merge `ESTADO DE RESULTADOS - {SUCURSAL}` 16pt `#1F4E78`. Filas: cabecera `VARIABLES | {días} | TOTAL ACUMULADO`; sección `INGRESOS OPERATIVOS` (por sourceType) + `TOTAL INGRESOS`; sección `EGRESOS OPERATIVOS` (título rojo `#C00000`) + `TOTAL EGRESOS`; `UTILIDAD NETA`. Montos `"$"#,##0.00`; cabecera `#1F4E78` blanca; resúmenes bold `#F2F2F2` borde double.
- **Hoja 2 "Desglose Detallado"**: `FECHA`(date,20) `REFERENCIA / GUÍA`(ref,25) `TIPO`(type,15) `CATEGORÍA`(category,30) `DESCRIPCIÓN`(desc,45) `IMPORTE`(amount,20). autoFilter A1:F1.
- **Hoja 3 "Dashboard"**: 4 cols (35/20/35/20), título A1:D1 `RESUMEN EJECUTIVO DE OPERACIÓN`, tabla `CATEGORÍA INGRESO | MONTO | CATEGORÍA EGRESO | MONTO` (cabecera `#4472C4`); colorScale en B (verde) y D (rojo); montos `"$"#,##0.00`.
- Datos: Income + Expense (con prorrateo diario `dailyShareForDay`), Subsidiary.name.

### B5. `inventory_no67_excel` (Excel, 3 hojas)
- Origen: `src/inventories/inventories.service.ts:1334` `generateExcelReport(subsidiaryId)` (addSummarySheet/addDetailsSheet/addStatisticsSheet). Endpoint `GET /monitoring/inventory-67/:subsidiaryId/excel`.
- **Hoja 1 "Resumen"**: título A1:G1 `REPORTE - SHIPMENTS SIN CÓDIGO 67` (16pt, fondo `#2E75B6`). Pares etiqueta/valor: Fecha generación (`dd/mm/yyyy hh:mm`), Fecha inventario, ID Inventario, Total, Sin 67, Con 67, % sin 67. Cols 25/25.
- **Hoja 2 "Detalles"** (frozen ySplit:1, autoFilter A1:I1, cabecera `#5B9BD5` blanca): `No.`(index,8) `Tracking Number`(trackingNumber,25) `Estado`(currentStatus,20) `Historial`(statusHistoryCount,12) `Códigos`(exceptionCodes,25) `Primera Fecha`(firstStatusDate,22) `Última Fecha`(lastStatusDate,22) `Días`(daysInSystem,10) `Comentario`(comment,30). Fechas `dd/mm/yyyy hh:mm`; días `0`; alternas `#F2F2F2`.
- **Hoja 3 "Estadísticas"**: título A1:C1 `ESTADÍSTICAS`; "Distribución por Estado" (`Estado|Cantidad|Porcentaje`) y "Distribución por Días" (rangos 0-7/8-30/31-90/91-180/>180/Sin fecha). Cols 25/15/15.

### B6. `shipments_no67_excel` (Excel, 2 hojas)
- Origen: `src/shipments/shipments.service.ts:4864` `exportNo67Shipments(shipments, res)`. Endpoint `shipments.controller.ts:768`.
- **Hoja 1 "Shipments Sin Código 67"**: título merge A:I `🚨 REPORTE: SHIPMENTS SIN CÓDIGO 67` (16pt blanco, fondo `#FF6B6B`); bloque Fecha/Hora generación + Total. Columns (cabecera `#8C5E4E` blanca): `No.`(5) `Número de Tracking`(22) `Estado Actual`(15) `Cantidad de Estados`(12) `Códigos de Excepción`(25) `Fecha Primer Estado`(18) `Fecha Último Estado`(18) `Días Sin Código 67`(15) `Observaciones`(25). Alternas `#F2F2F2`; semáforo por días sin 67 (>7 `#FFE6E6`/`#990000`; 3-7 `#FFF0F0`/`#CC0000`; col 8 >5/>2); color por estado col 3 (en ruta `#FFF2CC`, entregado `#E2F0D9`, bodega `#DEEBF7`, devuelto `#F2F2F2`).
- **Hoja 2 "Resumen"**: título A:B `📊 RESUMEN` (fondo `#FF6B6B`); secciones ESTADÍSTICAS GENERALES, ALERTAS POR TIEMPO (Críticos>3 / Alerta 2-3 / Normales 0-1), CÓDIGOS DE EXCEPCIÓN (código→frecuencia desc), TOP 5 MÁS ANTIGUOS. Cols 35/15.

### B7. `received_67_excel` (Excel, hoja "Recibidas con 67")
- Origen: `src/shipments/shipments.service.ts:4697` `exportReceived67Excel(rows)`. Endpoint `shipments.controller.ts:737` → `recibidas_67_{sub}_{ts}.xlsx`. Fila 1 bold.
- Columns: `Guía`(trackingNumber,22) `Fecha 67`(fecha67,20) `Días desde 67`(diasDesde67,14) `Estatus`(status,22) `Destinatario`(recipientName,26) `Dirección`(recipientAddress,34) `Ciudad`(recipientCity,18) `CP`(recipientZip,10) `Tipo`(tipo,10). fecha67 `toLocaleString('es-MX')`; tipo Carga/Envío.

### B8. `pending_shipments_excel` (Excel, hoja "Pendientes")
- Origen: `src/shipments/shipments.service.ts:6890` `generatePendingShipmentsExcel(shipments)`. Endpoint `shipments.controller.ts:172`. Cabecera fondo `#1E293B` blanca centrada, frozen ySplit:1.
- Columns: `Tracking`(18) `Tipo`(10) `Carga`(10) `Estado`(14) `Prioridad`(12) `Fecha compromiso`(22) `Destinatario`(26) `Dirección`(30) `Ciudad`(18) `CP`(10) `Teléfono`(16) `Recibido por`(22) `Consolidado`(36) `Alto valor`(12) `Creado`(22). tipo FedEx/DHL/Otro; carga Carga/Normal; isHighValue Sí/No; fechas `formatToHermosillo`.

### B9. `audit_log_excel` (Excel, hoja "Auditoría") — superadmin
- Origen: `src/audit/audit.controller.ts:76` `exportExcel`. Endpoint `GET /audit/export/excel` → `auditoria.xlsx`. Fila 1 bold.
- Columns: `Fecha`(createdAt,22) `Usuario`(userEmail,28) `Nombre`(userName,24) `Rol`(role,12) `Módulo`(module,18) `Sucursal`(subsidiaryName,22) `Acción`(action,14) `Registro`(entityId,26) `Resultado`(result,12) `IP`(ip,16) `Descripción`(description,50). createdAt `toLocaleString('es-MX')`.

---

## C) DOCUMENTOS GENERADOS EN EL FRONTEND (10 = 5 PDF + 5 Excel) — adjuntos de correos

Motores: PDF `@react-pdf/renderer` (JSX→Blob), Excel `exceljs`. Se suben con `FormData` campo `files` (PDF primero, Excel después) a `POST /{operacion}/upload`. **Portar a backend conservando el frontend como respaldo (no borrar).** Datos vía `mapToPackageInfo` → `PackageInfo{trackingNumber, recipientName, recipientAddress, recipientZip, recipientPhone, payment.{type,amount}, commitDateTime, isCharge, isHighValue, isValid, shipmentType, consolidated.type, status, lastHistory.exceptionCode}`.

### C1. `route_dispatch_pdf_client` — Salida a Ruta (PDF)
- Origen: `lib/services/package-dispatch/package-dispatch-pdf-generator.tsx` `FedExPackageDispatchPDF`. Endpoint `POST /package-dispatchs/upload`.
- LETTER **landscape**, multipágina (header tabla `fixed`). Header: logo + `SALIDA A RUTA` + fecha/hora. Grid: Sucursal, Vehículo, Chofer Principal. Fila 11 métricas: RUTA, SEGUIMIENTO, TOTAL, REGULARES, F2/31.5, ALTO VALOR, CON COBRO, VENCEN HOY, MONTO($), Fedex, DHL. Simbología `[C] CARGA/F2/31.5 · [$] PAGO · [H] VALOR ALTO · [A] AÉREO (PRIORIDAD)`.
- Tabla principal cols: `[#]`(30,iconos), `NO. GUIA`(65), `NOMBRE`(135,trunc22), `DIRECCIÓN`(155,trunc26), `CP`(26), `COBRO`(63,`${type} $${amount}`), `FECHA`(47), `HORA`(38 — **omitida si Hermosillo**), `CELULAR`(50), `NOMBRE Y FIRMA`(40/80). Tabla secundaria "TRACKINGS INVÁLIDOS" (nueva página, solo # + NO. GUIA).
- Reglas: alternas; pago `#fff2cc` bold; vence hoy `#ffe6e6` bold; separador de zona por cambio de 2 primeros dígitos CP (si `sortByPostalCode`); orden `sortByZip` si config sucursal. Estadísticas: f2Count, cargaCount/highValueCount, withPaymentCount+totalPaymentAmount, fedexCount/dhlCount, expiringTodayCount.
- Adjunto: `${DRIVER}--${sub}--Salida a Ruta--${dd-MM-yyyy}.pdf`.

### C2. `route_dispatch_excel_client` — Salida a Ruta (Excel, hoja "Despacho")
- Origen: `lib/services/package-dispatch/package-dispatch-excel-generator.tsx` `generateDispatchExcelClient`.
- Título fila1 merge A:I `🚚 Salida a Ruta` (16 bold blanco, `#ef883a`). Info (merge A:E): Ruta, Conductores, Unidad, Fecha `yyyy-MM-dd HH:mm`, Paquetes. Sección "❌ Guías Inválidas" (si hay; título `#FF0000`, guías 6/fila fondo `#FFE6E6`).
- Columns A→I (cabecera `#8c5e4e` bold blanca, h20): `No.`(5) `Guía`(18) `Recibe`(30) `Dirección`(40) `CP`(10) `Cobro`(18) `Fecha`(12) `Hora`(12) `Celular`(18). Fila: idx+1, tracking, name, address, zip, `${type} $ ${amount}`, `yyyy-MM-dd`, `HH:mm:ss`, phone. Alternas `#F2F2F2`; pago `#fff2cc`.

### C3. `unloading_pdf_client` — Desembarque (PDF)
- Origen: `lib/services/unloading/unloading-pdf-generator.tsx` `UnloadingPDFReport`. Endpoint `POST /unloadings/upload`.
- LETTER **landscape**. Título `Desembarque` + logo. Header: Sucursal, Unidad, No. Paquetes, Fecha `dd/MM/yyyy HH:mm`. Simbología `[C] Carga/F2/31.5 [$] Pago [H] Valor alto`. Número de seguimiento.
- Tabla cols: `[#]`(25,iconos), `No. Guía`(63), `Nombre`(175,trunc32), `Dirección`(185,trunc38), `C.P.`(40), `Cobro`(55,`${type} MXN`), `Fecha`(55,dd/MM/yyyy), `Hora`(45,HH:mm), `Celular`(50). Cabecera `#9d5137`. Tablas extra: "* Guías faltantes" (con datos), "** Guías sobrantes" (solo tracking).
- Adjunto: `${sub}--Desembarque--…${dd-MM-yyyy}.pdf`.

### C4. `unloading_excel_client` — Desembarque (Excel, hoja "Desembarque")
- Origen: `lib/services/unloading/unloading-excel-generator.tsx` `generateUnloadingExcelClient`.
- Título merge A:I `📦 Desembarque` (`#ef883a`). Info: Unidad, Fecha `dd/MM/yyyy HH:mm`, Paquetes. Columns A→I (cabecera `#8c5e4e`): `No.`(5) `Guía`(18) `Nombre`(45) `Dirección`(45) `C.P.`(12) `Cobro`(20) `Fecha`(12) `Hora`(12) `Celular`(18). Secciones extra "❌ Paquetes faltantes" (`#ef883a`) y "📍 Guías sobrantes" (`#8c5e4e`).

### C5. `inventory_pdf_client` — Inventario (PDF)
- Origen: `lib/services/inventory/inventory-pdf-generator.tsx` `InventoryPDFReport`. Endpoint `POST /inventories/upload`.
- LETTER **portrait**. Título `INVENTARIO DE PAQUETES` + logo + fecha/hora. Grid: SUCURSAL, FECHA INVENTARIO, TOTAL, VÁLIDOS, CARGA, ALTO VALOR. Tabla cols: `#`(25,badges C/$/H), `GUÍA`(80), `NOMBRE`(100,trunc20), `DIRECCIÓN`(110,trunc22), `CP`(50), `COBRO`(70,`${type} $${amount}`), `FECHA`(60,yyyy-MM-dd), `HORA`(50,HH:mm). 4 statBox; "GUIAS FALTANTES" y "GUIAS SIN ESCANEO" (máx 15 + "…y N más"); firmas RESPONSABLE/SUPERVISOR; footer.
- Adjunto: `INVENTARIO-${TIPO}--${sub}--${dd-MM-yyyy}.pdf`.

### C6. `inventory_excel_client` — Inventario (Excel, hoja "Inventario")
- Origen: `lib/services/inventory/inventory-excel-generator.tsx` `generateInventoryExcel`.
- Título merge A:I `📦 Inventario` (`#ef883a`). Info: Sucursal, Fecha `yyyy-MM-dd HH:mm`, Paquetes. Columns A→I (cabecera `#8c5e4e`): `No.`(5) `Guía`(18) `Nombre`(40) `Dirección`(45) `CP`(12) `Cobro`(20) `Fecha`(12) `Hora`(12) `Celular`(18). Secciones "❌ Missing Trackings" (`#ef883a`), "📍 UnScanned Trackings" (`#8c5e4e`).

### C7. `route_closure_pdf_client` — Cierre de Ruta (PDF)
- Origen: `lib/services/route-closure/route-closure-pdf-generator.tsx` `RouteClosurePDF`. Endpoint `POST /route-closure/upload`.
- LETTER **portrait**. Título `CIERRE DE RUTA` + logo + fecha/hora. Grid: Sucursal, Vehículo, Chofer, Ruta(s), Fecha Despacho, POD Entregados. 2 columnas:
  - Izq: tabla **DEVUELTOS** [`GUÍA` 45%, `TIPO` 20%, `MOTIVO`(getDexCode) 35%]; tabla **PAQUETES NO VAN** [`GUÍA` 60%, `ESTATUS` 40%]; bloques DEX 03/07/08/12.
  - Der: **DESGLOSE POR PAQUETERÍA** (FedEx/DHL × TOTAL/ENT/DEV); **RECOLECCIONES** (multi-col tracking); **COBROS** [`GUÍA` 50%, `TIPO` 25%, `MONTO` 25%]; statBox SALIDA/NO VAN/ENTREGADOS/% DEVOLUCIÓN. Firmas; footer.
- Adjunto: `CIERRE--${DRIVER}--${sub}--Devoluciones--${dd-MM-yyyy}.pdf`.

### C8. `route_closure_excel_client` — Cierre de Ruta (Excel, hoja "Cierre de Ruta")
- Origen: `lib/services/route-closure/route-closure-excel-generator.tsx` `generateRouteClosureExcel`.
- Título `📋 CIERRE DE RUTA` (`#8c5e4e`). Secciones: (1) INFORMACIÓN GENERAL (CAMPO/VALOR, header `#6d4c41`): Sucursal, Unidad, Conductor, Rutas, Fecha Salida, Km Inicial/Final, No. Seguimiento, Total Paquetes(`#,##0`), Entregas Efectivas(`#,##0`), Fecha Cierre(`yyyy-MM-dd HH:mm:ss`). (2) ESTADÍSTICAS. (3) PAQUETES DEVUELTOS: `No.`,`GUÍA`,`MOTIVO`(`DEX-{code}`),`DESTINATARIO`,`TELÉFONO`,`DIRECCIÓN`,`FECHA`,`HORA` + TOTAL. (4) CONTEO POR CÓDIGO DEX (03/07/08/12/OTROS/SIN/TOTAL). (5) RECOLECCIONES: `No.`,`GUÍA` + TOTAL. (6) COBROS: `No.`,`GUÍA`,`MONTO`(`"$"#,##0.00`),`TIPO` + TOTAL. Colores: `#8c5e4e`/`#6d4c41`, alternas `#F8F9FA`, totales `#E8E8E8`.

### C9. `returning_pdf_client` — Devoluciones y Recolecciones (PDF)
- Origen: `lib/services/pdf-generator.tsx` `EnhancedFedExPDF`. Endpoint `POST /devolutions/upload`.
- **A4 portrait**. Branding "FedEx" (`Fed` `#662d91` + `Ex` `#ff6600`) + FECHA. LOCALIDAD + subsidiary (upper) + "DEVOLUCIONES Y RECOLECCIONES". 3 summaryBox (TOTAL RECOLECCIONES / DEVOLUCIONES / GENERAL). 2 columnas:
  - **DEVOLUCION** [header morado]: `No.`15%, `NO. GUIA`40%, `MOTIVO`45% (getStatusCode→DEX rojo); rellena hasta 15 filas.
  - **RECOLECCIONES** [header naranja]: `NO. GUIA`60%, `SUC.`20% (sub[0:3] upper), `No.`20%.
  - Firma; footer leyenda DEX 03/07/08/17. Mapeo `STATUS_TO_DEX_CODE`.
- Adjunto: `${DRIVER}--${sub}--Devoluciones--${dd-MM-yyyy}.pdf`.

### C10. `returning_excel_client` — Devoluciones y Recolecciones (Excel, hoja "Reporte")
- Origen: `lib/services/returning/returning-excel-generator.tsx` `generateFedExExcel` (el ACTIVO del correo; NO el `-con-cobros`).
- 8 cols A–H (anchos [8,25,25,5,5,25,18,8]). Título merge A1:H1 `FedEx - Devoluciones y Recolecciones` (`#662D91`). `LOCALIDAD: {SUB}` (A2). Fecha `dd/MM/yyyy` (A3). Resumen fila5: TOTAL RECOLECCIONES / DEVOLUCIONES / GENERAL. Tablas espejo (fila7): **DEVOLUCIONES** (A:C `#662D91`) `No.`,`GUIA`,`MOTIVO`(DEX rojo); **RECOLECCIONES** (F:H `#FF6600`) `GUIA`,`SUCURSAL`(3 letras),`No.`. Leyenda DEX 03/07/08/17. Guías `numFmt '@'`.

---

## Descartar (NO migrar)
- Legacy backend: `generateDriverReportExcelResp1803/2303/2303v02` (package-dispatch.service.ts).
- Frontend NO adjuntados a correo (solo descarga/vista): `returning-excel-generator-con-cobros.tsx`, `export-devolution-to-excel.ts`, `pdf-generator-package-dispatch.tsx` (jsPDF legacy no importado), reportes en `lib/services/reportes/*`, `route-board-export.ts`, `warehouse-excel.ts`, `export-to-excel*.ts`, lectores `readExcelFile/readCSVFile`.
- Módulos que solo reenvían archivos subidos: `devolutions.controller.ts:57`, `warehouse.controller.ts:100`→`sendEmailNotification`.

## Totales
- **12 correos** + **9 backend** (8 Excel + 1 PDF) + **10 frontend** (5 PDF + 5 Excel) = **31 plantillas** a precargar con paridad.

# Bandeja de correo FedEx + detección de sucursal + recibido vs subido

Fecha: 2026-10-01 · Rama: `feat/bandeja-correo-fedex` (pmy-api y app-pmy)

## Objetivo

Leer el buzón `sistemas@paqueteriaymensajeriadelyaqui.com` (al que FedEx manda los archivos de
consolidado), mostrarlo en la app, detectar con precisión a qué sucursal y tipo pertenece cada correo
y cada adjunto, y medir por sucursal qué se recibió y qué ya se subió al sistema.

Este spec cubre las fases 1–3 de la hoja de ruta. Las fases 4–6 son specs aparte que se apoyan en
`inbox_consolidation`:

| Fase | Contenido | Spec |
|---|---|---|
| 1 | Bandeja FedEx (IMAP solo lectura, guardado, pantalla) | **este** |
| 2 | Detección de sucursal/tipo/consolidado/cobros + aprendizaje + cobertura CP | **este** |
| 3 | Tablero recibido vs subido | **este** |
| 4 | Alertas (in-app/correo/WhatsApp, "llegó hace 10 min y no se sube") | futuro |
| 5 | Subida automática (sugerir → pegar con 1 clic → automático con certeza total) | futuro |
| 6 | Tareas operativas (desembarque → salida a ruta → cierre → inventario) | futuro |

## Hechos del dominio (de correos reales)

- Remitentes: personas de FedEx con distintas cuentas, siempre `@fedex.com` (o subdominio como
  `corp.ds.fedex.com`). El buzón también recibe muchísimos correos "PMY App" (nuestros propios avisos
  en CC) — se ignoran.
- Asuntos: `CARGA YAQUI CABO 10/01/26`, `CARGA YAQUI SUR 093026`, `CARGA YAQUI COMONDU 100126`,
  `PREALERTA CABORCA PAQUETERIA DEL YAQUI`, `Sensitive-External - PREALERTA DEL YAQUI LOCAL RUTA 364, 367…`,
  y a veces nada útil (`Salida Aerea.`, `salida yaqui.`).
- Adjuntos: `CARGA_<cons>_YAQUI_SJDA.xlsx` (master), `CCP_<cons>_….xlsx` (carta porte, se ignora si
  viene master), `F2.xlsx` (F2/31.5), `YAQUI.xlsx` (master), `ccp aereo`/`salida aereo` (master aéreo,
  `isAereo`), `ccp valor`/`salida valor` (High Value), `PREALERTA … .xls` (master) + `.pdf` (se ignora).
- Cuerpo: `MASTER 305821242296, 189 GUIAS.`, `F2 305821512729 , 15GUIAS.`,
  `CARGA YAQUI 305821198046, 87 GUIAS.`, `CONS:818861721255`, `PAQUETES:123`,
  `RUTA: CABORCA-PENASCO-SANTA ANA-BENJAMIN H.`, y tabla de cobros
  (`Tracking Number | [Last COMM Scan Date] | Last COMM Scan Update` con `COD-COLLECT CASH 2210.0 MXP`,
  `FTC-COLLECT CASH 579.64 MXP`, `PIP NO AHS`), o `NO PRECENTAN COBRO`.
- Hilos: las PREALERTA responden sobre el mismo hilo y arrastran decenas de consolidados viejos
  debajo de `From:`/`De:`/`Enviado:` → solo cuenta el mensaje superior.
- Bloque boilerplate `**IMPORTANTE** Regresar el mismo archivo…` y avisos `Caution! This email…` se descartan.

## Arquitectura (pmy-api)

Módulo nuevo `src/inbox/`:

| Unidad | Responsabilidad | Depende de |
|---|---|---|
| `imap-reader.service.ts` | Conecta por IMAP (imapflow), lista UIDs > último leído, descarga con `BODY.PEEK` (no marca leído). Nunca mueve/borra. | `.env` |
| `mail-parse.util.ts` (puro) | mailparser → remitente real, to/cc, asunto, fecha, texto/HTML; corte de hilo; limpieza de boilerplate. | — |
| `extract.util.ts` (puro) | Extrae consolidados (MASTER/F2/CARGA/CONS + guías anunciadas), cobros del cuerpo (texto y tabla HTML), números en nombres de archivo. | — |
| `attachment-classify.util.ts` (puro) | Tipo de cada adjunto por nombre + contenido (encabezados FedEx vía `header-detector.util`, DHL 3 hojas vía `dhl-excel.util`), resumen (filas, CP, ciudades). Regla: CCP → `ccp_ignored` si en el correo hay master. | xlsx |
| `detector.ts` (puro) | Recibe `DetectionInput` (texto normalizado, adjuntos clasificados, remitente/cc, y "conocimiento": catálogo de sucursales, cobertura CP, alias, consolidados conocidos) → `DetectionResult` (sucursal, confianza, señales, `autoSafe`, versión). | — |
| `knowledge.service.ts` | Carga el conocimiento desde BD para el detector; aplica aprendizaje en confirmaciones. | BD |
| `zip-coverage.service.ts` | Recalcula `subsidiary_zip_coverage` desde historial (cron 03:30) y suma CP de correos confirmados. | BD |
| `inbox-ingest.service.ts` | Orquesta: leer → filtrar dominio → guardar mensaje/adjuntos (disco) → clasificar → detectar → upsert `inbox_consolidation`. | todo lo anterior |
| `inbox-ingest.cron.ts` | Cada 2 min (America/Hermosillo), candado `running`, desactivable por config. | ingest |
| `inbox-link.cron.ts` | Cada 5 min: liga `inbox_consolidation` pendientes con lo subido (consolidated/charge por `consNumber`) → `uploadedAt`, `uploadedById`, `uploadMinutes`. | BD |
| `inbox.controller.ts` | Endpoints (abajo), `@RequirePermission('correo.bandejaFedex')`. | servicios |

Dependencias nuevas: `imapflow`, `mailparser` (y `sanitize-html` para mostrar HTML).

### Variables de entorno (en `.env.example` sin valores)

`INBOX_IMAP_HOST`, `INBOX_IMAP_PORT` (993), `INBOX_IMAP_TLS` (true), `INBOX_IMAP_USER`,
`INBOX_IMAP_PASSWORD`, `INBOX_IMAP_MAILBOX` (INBOX), `INBOX_STORAGE_DIR`, `INBOX_ENABLED` (false por defecto),
`INBOX_BACKFILL_DAYS` (30), `INBOX_ALLOWED_DOMAINS` (`fedex.com`).

## Modelo de datos (migración `1786000000086-CreateInbox`)

`inbox_message`
- `id`, `uidValidity`, `uid` (único compuesto), `messageId` (único), `fromAddress`, `fromName`,
  `toAddresses` (json), `ccAddresses` (json), `subject`, `receivedAt`, `textTop` (mensaje superior,
  normalizado), `htmlSafe` (sanitizado, completo), `hasQuotedHistory`,
  `status` enum(`nuevo`,`detectado`,`revision`,`confirmado`,`ignorado`,`error`),
  `ignoreReason`, `errorMessage`, `attempts`, `subsidiaryId` (final, nullable),
  `confirmedById`, `confirmedAt`, `createdAt`, `updatedAt`.

`inbox_attachment`
- `id`, `messageId` FK, `filename`, `contentType`, `size`, `sha256`, `storagePath`,
  `kind` enum(`master`,`master_aereo`,`f2`,`high_value`,`ccp`,`ccp_ignored`,`dhl`,`pdf`,`other`),
  `kindSource` (`nombre`|`contenido`|`manual`), `consNumber`, `rowCount`, `zipSummary` (json: top CP → n),
  `citySummary` (json), `parseError`.

`inbox_detection`
- `id`, `messageId` FK, `subsidiaryId` (nullable), `confidence` (0–1), `autoSafe` bool,
  `signals` (json: `[{type, value, subsidiaryId, weight, note}]`), `runnerUp` (json), `reason`
  (texto llano), `detectorVersion`, `createdAt`. Una fila por corrida; la vigente es la más reciente.

`inbox_consolidation`
- `id`, `messageId` FK, `consNumber`, `kind` (`master`|`f2`|`aereo`|`high_value`|`dhl`),
  `subsidiaryId`, `announcedCount`, `cobros` (json `[{trackingNumber, date, concept, amount}]`),
  `receivedAt`, `uploadedAt`, `uploadedById`, `uploadedVia` (`manual`|`auto`, nullable),
  `uploadMinutes`, `linkStatus` (`pendiente`|`subido`|`no_aplica`). Único `(consNumber, kind)`;
  un reenvío del mismo consolidado actualiza, no duplica (guarda el `receivedAt` más temprano).

`inbox_signal_alias`
- `id`, `signalType` (`termino`|`remitente`|`copia`|`estacion`), `term` (normalizado),
  `subsidiaryId`, `hits`, `misses`, `source` (`catalogo`|`historial`|`confirmacion`|`manual`),
  `lastSeenAt`. Único `(signalType, term, subsidiaryId)`.

`inbox_sync_state`
- `id`, `mailbox`, `uidValidity`, `lastUid`, `lastRunAt`, `lastOkAt`, `lastError`, `enabled`.

`subsidiary_zip_coverage`
- `id`, `zip`, `subsidiaryId`, `city`, `state`, `shipmentCount`, `share` (0–1 dentro del CP),
  `source` (`historial`|`correo`|`manual`), `status` (`sugerido`|`confirmado`|`excluido`),
  `firstSeenAt`, `lastSeenAt`. Único `(zip, subsidiaryId)`.

Permiso nuevo `correo.bandejaFedex` (catálogo + migración `Sync…Permission`, solo `superadmin` por defecto).

## Flujo de ingesta

1. Cron (si `enabled`): conectar, leer `uidValidity`. Si cambió → reiniciar `lastUid` y releer ventana
   de backfill; los repetidos se descartan por `messageId`.
2. Primera vez: `SEARCH SINCE hoy-INBOX_BACKFILL_DAYS`. Después: `UID lastUid+1:*`.
3. Por correo: parsear. Si el remitente real no termina en un dominio permitido → `ignorado`
   (`ignoreReason: "No viene de FedEx"`), sin procesar adjuntos.
4. Guardar mensaje + adjuntos en `INBOX_STORAGE_DIR/AAAA/MM/<id>/` (no en BD).
5. Clasificar adjuntos (solo `.xls/.xlsx/.ods/.csv` se abren; límite 10 MB y 20 000 filas).
6. Extraer consolidados y cobros del mensaje superior; cruzar con números de los nombres de archivo.
7. Detectar sucursal (abajo) → `inbox_detection`; `status = detectado` si `autoSafe`, si no `revision`.
8. Upsert de `inbox_consolidation` por cada consolidado con la sucursal detectada (aunque esté en revisión;
   se actualiza al confirmar).
9. Avanzar `lastUid` solo tras guardar. Errores de un correo → `status=error`, `attempts++`, reintento
   hasta 3; no frena el lote.

## Motor de detección (`detector.ts`, versión `1`)

**Normalización:** mayúsculas, sin acentos, puntuación → espacio, espacios colapsados. Corte del hilo en
la primera línea que empiece con `From:`, `De:`, `Enviado:`, `Sent:`, `-----Original` o `On … wrote`.
Se quitan bloques boilerplate (IMPORTANTE…, Caution!…, firmas tras `Saludos`/`|` de firma FedEx).

**Señales** (cada una: sucursal + peso; tipos y pesos base):

| Señal | Peso | Regla |
|---|---|---|
| `consolidado_conocido` | 1.0 | `consNumber` extraído existe en consolidated/charge con sucursal |
| `cp_archivo` | 0.9 | ≥ 85 % de filas con CP en cobertura (no excluida) de una sucursal; confirmado pesa 1×, sugerido 0.8× |
| `ciudad_archivo` | 0.6 | respaldo si no hay CP: ≥ 85 % de ciudades en cobertura de una sucursal |
| `asunto_o_archivo` | 0.8 | nombre/variante de sucursal, alias aprendido o ciudad de su cobertura en asunto o nombre de archivo (término más largo gana; palabras genéricas YAQUI/CARGA/PAQUETERIA/SALIDA excluidas) |
| `cuerpo` | 0.5 | igual que arriba pero en el cuerpo superior (`RUTA: …`) |
| `remitente` | 0.7 × concentración | alias `remitente` con ≥ 5 confirmaciones; vota si ≥ 90 % a una sucursal; si está disperso solo aporta región |
| `copia`/`estacion` | 0.4 × precisión | alias aprendidos (`loscabosteam`, `HMOA`, `SJDA`) con precisión ≥ 90 % y ≥ 3 hits |
| `region` | filtro | firma/estación (La Paz/BCS vs Hermosillo/Sonora) descarta sucursales de la otra región |

Alias `termino` precargados desde el catálogo: nombre normalizado de cada sucursal y variantes
(sin "Bodega", errores de escritura conocidos tolerados por distancia de edición ≤ 1 para términos ≥ 6
letras). Las ciudades de cobertura se derivan de `subsidiary_zip_coverage.city`.

**Puntaje:** suma de pesos por sucursal. `confidence = ganador / total`.

**`autoSafe` (certeza total) exige las tres:**
1. Ganador con ≥ 2 señales independientes, al menos una fuerte (`consolidado_conocido` o `cp_archivo`).
2. Ninguna señal de peso ≥ 0.5 vota por otra sucursal.
3. `confidence ≥ 0.85`.

Si no → `revision` con `reason` en llano (p. ej. "Los códigos postales apuntan a Hermosillo y Bodega
Hermosillo por igual" / "El asunto dice Cabo pero los CP dicen La Paz").

**Aprendizaje (`knowledge.service.confirm`):** al confirmar/corregir, cada señal emitida suma `hits` si
apuntó a la sucursal final o `misses` si no; se crean alias `remitente`, `copia` y `estacion` (códigos de 4
letras en nombres de archivo, p. ej. `SJDA`) para la sucursal final; los CP de sus adjuntos entran a
`subsidiary_zip_coverage` con `source=correo`. Un alias con precisión < 70 % deja de votar.

**Tipo de adjunto:** por nombre (`aereo`→master_aereo, `valor`→high_value, `f2`/`31.5`→f2,
`ccp`→ccp, `.pdf`→pdf, `carga`/`prealerta`/`yaqui`→master) y por contenido (columnas FedEx de
`header-detector.util` → master si no se sabía; formato DHL 3 hojas → dhl). CCP pasa a `ccp_ignored` si
el correo trae master. Cambio manual de tipo → `kindSource=manual`.

## Cobertura CP (`subsidiary_zip_coverage`)

- Arranque y cron 03:30: agrega `shipment` y `charge_shipment` por `(recipientZip, subsidiaryId)` → conteos,
  `share` por CP, ciudad/estado más frecuentes. Respeta `status` existente (no pisa `confirmado`/`excluido`).
- Confirmación de correo suma CP con `source=correo`.
- Edición manual (confirmar / excluir / agregar) desde Configuración.

## Ligado recibido vs subido (`inbox-link.cron`)

Cada 5 min para `inbox_consolidation.linkStatus=pendiente`: buscar el consolidado real por `consNumber`
(tabla de consolidados para master/aéreo/HV, charge para F2). Al encontrarlo: `uploadedAt` =
`createdAt` del registro real, `uploadedById`, `uploadedVia=manual`, `uploadMinutes`,
`linkStatus=subido`. Tipos que no generan consolidado propio → `no_aplica`.

## API (`/inbox`, permiso `correo.bandejaFedex`, filtrado a sucursales del usuario salvo superadmin)

- `GET /inbox/messages?status&subsidiaryId&from&to&q&page` — lista.
- `GET /inbox/messages/:id` — detalle (mensaje, adjuntos, detección vigente, consolidados).
- `GET /inbox/attachments/:id/download`
- `POST /inbox/messages/:id/confirm` `{ subsidiaryId, attachmentKinds?: {id: kind} }`
- `POST /inbox/messages/:id/ignore` `{ reason }`
- `POST /inbox/redetect` `{ ids? }` — re-evalúa no confirmados.
- `POST /inbox/sync` — leer ahora.
- `GET /inbox/status` / `PUT /inbox/status` `{ enabled }` (superadmin) — estado de la lectura.
- `GET /inbox/board?from&to&subsidiaryId` — tablero recibido vs subido.
- `GET /inbox/zip-coverage?subsidiaryId` / `PUT /inbox/zip-coverage/:id` / `POST /inbox/zip-coverage`.

## Pantallas (app-pmy)

Reglas de casa: `AppLayout` + `withAuth` + `OperationHeader` (acciones en el header), solo shadcn +
Tailwind, `DataTable`, densidad de un renglón, textos en llano.

1. **Operaciones → Correos FedEx** (`/correos-fedex`): header con sucursal, rango, "Leer correo ahora";
   vistas con contador (Por revisar · Detectados · Confirmados · Ignorados · Todos); tabla: hora,
   remitente, asunto, sucursal (pastilla por certeza), adjuntos por tipo, consolidados, guías anunciadas,
   cobros, estado de subida.
2. **Detalle** (panel lateral): cuerpo sanitizado (hilo plegado, sin imágenes remotas), adjuntos con tipo
   y resumen, sección "¿Por qué esta sucursal?" con cada señal; acciones Confirmar / Cambiar sucursal /
   Cambiar tipo / Ignorar.
3. **Pestaña Recibido vs subido**: por sucursal y día (recibidos, subidos, pendientes, tiempo promedio,
   peor retraso); detalle por consolidado; pendientes ámbar ≥ 10 min y rojo ≥ 30 min (solo visual).
4. **Configuración → Sucursales → Cobertura (CP)**: CP por sucursal, compartidos en rojo,
   confirmar/excluir/agregar.
5. **Configuración → Servidor → Correo FedEx** (superadmin): estado de conexión, última lectura,
   leídos hoy, dominios permitidos, activar/pausar.

## Errores y seguridad

- Solo lectura IMAP (`BODY.PEEK`), nunca mueve/borra/marca.
- Credenciales solo en `.env`. Remitente filtrado por dominio del header real.
- Adjuntos solo se leen como datos (sin macros/fórmulas). HTML sanitizado; imágenes remotas bloqueadas.
- Idempotencia por `(uidValidity, uid)` y `messageId`. Reintentos por correo (máx 3).
- Panel de servidor en rojo si 30 min sin lectura exitosa en horario hábil.
- Mensajes de error al usuario en llano.

## Pruebas

- Jest del detector con los 5 correos reales como fixtures (Cabo, Sur/La Paz, Comondú, Caborca con hilo
  largo → solo `818861721255`, "Salida Aerea." resuelto por CP/remitente), extracción MASTER/F2/CONS/
  cobros (incl. `NO PRECENTAN COBRO`, `PIP NO AHS`, tabla con/sin columna fecha), tipos de adjunto (CCP
  ignorado con master), choques → revisión, remitente concentrado vs disperso.
- Jest de cobertura CP (share, CP compartido) y del ligado (tiempo de subida).
- Script `scripts/inbox-dry-run.ts` de solo lectura contra el buzón real, últimos 30 días → reporte de
  detectados/revisión/motivos (precisión antes de activar).

## Fuera de alcance (este spec)

Alertas y notificaciones, subida automática / envío al pegado, tareas operativas, DHL más allá de
clasificar el adjunto, IMAP IDLE.

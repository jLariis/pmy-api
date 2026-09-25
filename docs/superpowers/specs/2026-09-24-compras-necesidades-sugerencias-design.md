# Compras v4: servicios predefinidos, "Lo que se necesita" y 4 sugerencias

**Fecha:** 2026-09-24 · **Repos:** pmy-api + app-pmy · **Modo:** inline, rama actual.

## Objetivo

1. Buscadores en los selects largos (ficha de unidad y resto del módulo); Notas con espacio real.
2. Separar Mantenimiento de Compras en el menú.
3. La solicitud ya no pide piezas/insumos: el usuario elige unidad + servicios predefinidos y/o describe qué pasa. Las piezas e insumos aparecen en la cotización.
4. En la cotización, el sistema propone lo que se necesita (receta del servicio + ficha de la unidad + palabras clave del texto) y, por cada pieza/insumo, 4 sugerencias de producto/proveedor: más comprado, mejor precio, mejor calidad, mejor calidad-precio.

## Decisiones tomadas

| Tema | Decisión |
|---|---|
| Receta de servicio | Opcional (con receta = sugerencia precisa; sin receta = por palabras clave) |
| Interpretar texto libre | Palabras clave y sinónimos editables, sin costo. Sin IA por ahora |
| Menús | Una sola pantalla "Mis solicitudes" (en Compras). Mantenimiento: Unidades, Historial, Servicios |
| Elegir sugerencia | Arma la cotización de ese proveedor con precio del catálogo; cada partida editable (existencia, días, precio, impuestos). Al guardar, el precio nuevo se actualiza en el catálogo (`upsertOffers` ya existente) |
| Cálculo | En backend: endpoint + funciones puras probadas |

## 1. Datos

Migración nueva (sin COLLATE explícito, idempotente):

- `service_template`: `id`, `name` (único), `description` null, `vehicleType` null, `keywords` text null (separados por coma), `active` bool, `createdAt/updatedAt`.
- `service_template_item`: `id`, `serviceTemplateId`, `categoryId` (product_category pieza/insumo), `quantity` decimal(10,2), `unitId` null, `sortOrder`.
- `request_service`: `id`, `requestId`, `serviceTemplateId`, `sortOrder` (servicios elegidos en la solicitud).
- `request_need`: `id`, `requestId`, `categoryId`, `productId` null (preferido), `quantity`, `unitId` null, `source` enum(`receta`,`ficha`,`palabra`,`manual`), `sourceLabel` varchar(200), `dismissed` bool default 0. Guarda la lista de necesidades para que Gerardo pueda quitar/agregar y se conserve entre visitas. Se genera la primera vez que se consulta (o al pedir "Recalcular").
- `product_category.keywords` text null.
- Semilla: servicios base sin receta ("Servicio preventivo", "Reparación general", "Revisión de frenos", "Afinación") y sinónimos iniciales en piezas/insumos comunes (frenos, aceite, llantas, filtros, suspensión). Todo editable.

Solicitudes existentes con `request_item` se conservan y se siguen cotizando como hoy.

## 2. Motor (backend, funciones puras con pruebas)

`src/maintenance/utils/needs.util.ts`

- `normalize(text)`: minúsculas, sin acentos, solo letras/números/espacios.
- `matchKeywords(text, entries: {id, name, keywords}[])`: compara cada palabra del texto con cada palabra del nombre/sinónimos. Coinciden si son iguales, o si comparten un prefijo común de al menos 4 letras y de al menos (largo de la más corta − 2) — así "frenar" ~ "frenos" y "balatas" ~ "balata", pero "freno" no ~ "frente". Sinónimos de varias palabras ("liquido de frenos") coinciden si aparecen todas sus palabras (ignorando "de/la/el/para"). Regresa `{id, matched}` con la palabra del texto que coincidió.
- `buildNeeds({ services(con receta), text, serviceCatalog, categories, spec })` → `Need[] {categoryId, productId|null, quantity, unitId|null, source, sourceLabel}`:
  1. Receta de cada servicio elegido.
  2. Palabras clave: servicios coincidentes con receta aportan su receta ("Por lo que escribió: *x*"); categorías coincidentes aportan una necesidad (cantidad 1).
  3. Ficha de la unidad: si la categoría está en la ficha, sobrescribe `productId`, `quantity`, `unitId` (la ficha manda para esa unidad).
  4. Sin duplicados por `categoryId` (gana el primer origen en orden receta > palabra; la ficha solo enriquece).

`src/maintenance/utils/rank-offers.util.ts`

- `rankOffers(candidates, { preferredProductId })`, candidato = `{offerId, productId, productName, brand, supplierId, supplierName, price, quality|null, purchases}`.
- Etiquetas:
  - `mas_comprado`: mayor `purchases` (>0); empate → más barato.
  - `mejor_precio`: menor `price`.
  - `mejor_calidad`: mayor `quality`; empate → más barato.
  - `mejor_relacion`: mayor `(quality ?? 3) / (price / minPrice)`.
  - En todo empate, el producto preferido de la ficha gana.
- Una oferta con varias etiquetas sale una vez con todas. Máximo 4 tarjetas; menos si hay menos candidatos; `[]` si no hay.

`purchases` = número de `purchase_order_item` con ese `productId` en órdenes `enviada`/`completada` del mismo proveedor.

## 3. Endpoints

- `GET maintenance/requests/:id/needs` (revisar): genera `request_need` si no existen (solo solicitudes con tipo ≠ compra o con texto), regresa `{ needs: [{id, category, product, quantity, unit, source, sourceLabel, suggestions: RankedOffer[], inQuote: {quoteId, supplierName} | null}] }`.
- `POST maintenance/requests/:id/needs` (revisar): agregar necesidad manual `{categoryId, quantity, unitId?}`.
- `DELETE maintenance/requests/needs/:needId` (revisar): marca `dismissed`.
- `POST maintenance/requests/:id/needs/recalculate` (revisar): borra las no manuales y regenera.
- `POST maintenance/requests/needs/:needId/pick` `{offerId}` (revisar): agrega la partida a la cotización del proveedor de la oferta (la crea si no existe: fecha hoy, notas "Armada desde el catálogo: confirma precio y existencia con el proveedor", `fromCatalog = true`), con precio/calidad de la oferta, `availability='si'`, `ivaEnabled=true`, `requestNeedId`. Si ya había partida de esa necesidad en otra cotización, se quita de ahí. Respeta `loadQuotable` (no si hay órdenes).
- Servicios: CRUD `maintenance/catalog/service-templates` (lectura: autenticados; escritura: catalogos/revisar), con items.
- Solicitud: `CreateRequestDto` acepta `serviceTemplateIds: string[]`; para tipos con unidad los `items` pasan a opcionales; para `compra` los items son texto libre (productId opcional).

`maintenance_quote.fromCatalog` bool default 0 (se apaga al editar/guardar la cotización a mano). `maintenance_quote_item.requestNeedId` null.

Comparativo: las partidas con `requestNeedId` se agrupan por necesidad (fila = necesidad) igual que hoy se agrupan por `requestItemId`. Filas del comparativo = renglones de la solicitud (si hay) + necesidades no descartadas.

## 4. Pantallas (app-pmy, solo shadcn + Tailwind)

- **Combobox con buscador** reutilizable (`components/maintenance/shared/searchable-select.tsx`, Popover + Command) usado en: ficha de unidad (pieza/insumo, producto preferido, presentación), receta de servicio, "Agregar necesidad" y selectores largos del módulo. Ficha: Notas en renglón propio de ancho completo.
- **Menús:** Compras = Mis solicitudes, Tablero de compras, Catálogos. Mantenimiento = Unidades, Historial, Servicios (`/mantenimiento/servicios`).
- **Servicios predefinidos:** DataTable + diálogo (nombre, descripción, tipo de unidad, sinónimos como chips, receta con combobox de pieza/insumo + cantidad + presentación).
- **Catálogos → Piezas/Insumos:** campo de sinónimos.
- **Nueva solicitud:** tipos con unidad → unidad + servicios (combobox múltiple) + "¿Qué necesita o qué le pasa?"; compra → renglones de texto libre. Botón "Solicitar servicio" en Unidades abre el formulario con la unidad.
- **Expediente (Compras):** tarjeta "Lo que se necesita" encima de cotizaciones: por necesidad, nombre, cantidad, origen, y 4 tarjetas (producto, marca, proveedor, precio, estrellas, etiquetas, botón "Elegir"); marca "✔ En cotización de X"; acciones de contenido "Agregar necesidad", "Recalcular", quitar. Cotizaciones `fromCatalog` con aviso "Precio del catálogo: confírmalo con el proveedor". La barra superior se queda igual (Pedir cotización, Agregar cotización, Generar órdenes).
- Mensajes en llano; al guardar una cotización con precio distinto al catálogo: "Se actualizó el precio de *X* con *Proveedor* a $Y".

## 5. Pruebas

- Unitarias: `normalize`, `matchKeywords`, `buildNeeds` (receta + palabras + ficha, sin duplicados, ficha manda), `rankOffers` (cada etiqueta, empates, sin estrellas, preferido, pocos/ningún candidato).
- Servicio: `pick` (crea/añade, mueve de otra cotización, respeta órdenes), `needs` genera una sola vez.
- Front (Vitest): helpers puros que se agreguen.
- Smoke contra BD real (sin AppModule completo para no chocar con WhatsApp; limpiar datos y folios; restaurar precios).

## Fuera de alcance

IA para interpretar texto; recetas por modelo de unidad; histórico de precios.

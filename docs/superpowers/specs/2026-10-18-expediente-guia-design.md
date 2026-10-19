# Expediente de la guía (Búsqueda interna)

## Por qué
Todos los días operación necesita saber la vida completa de una guía y hoy solo lo puede
contestar el responsable del sistema con consultas a la base. La pestaña "Búsqueda interna"
del buscador del header mostraba solo el registro más reciente, revolvía estatus FedEx con
salidas a ruta y no decía consolidado, desembarque, quién la dio de alta, inventarios,
ingreso ni devolución.

## Qué se construye
Solo lectura. Vive en la misma pestaña "Búsqueda interna" (modal más ancho).

- Busca por guía FedEx, guía DHL (maestra) o JD de pieza DHL (también JJD↔JD).
- Si la guía tiene varios registros (reingreso, paquete y carga, baja lógica) se ven todos:
  "Registro N de M", el más reciente primero; los dados de baja marcados.
- DHL: si la búsqueda cae en una maestra con varias piezas, se listan las piezas y se elige;
  si se busca un JD, se abre esa pieza y abajo se ven las demás piezas de la guía.
- Encabezado: guía, paquetería, paquete o carga (F2 / 1.5 ton), alto valor, prioridad,
  sucursal, estatus actual y vencimiento con aviso de vencida.
- Tarjetas: llegada + quién la dio de alta, consolidado, desembarque, cobro, ingreso,
  destinatario.
- Movimientos internos (solo estos 6): registro en el sistema, desembarque, salida a ruta
  (cada una: folio, chofer, unidad, 31.5, resultado del cierre), ingreso, inventario,
  devolución a FedEx/DHL (incluye si se deshizo). Los que no han pasado se ven en gris.
- Historial FedEx/DHL aparte: estatus, código y descripción de cada evento.

## Cómo (decisiones)
- Endpoint nuevo `GET /package-dossier/:query` en pmy-api; el endpoint viejo
  `search-by-trackingnumber` no se toca.
- Los movimientos internos se arman desde sus tablas (shipment/charge_shipment, unloading,
  package_dispatch_history + FK viva, income, inventory_*, devolution), no desde las notas.
- El historial FedEx/DHL son las filas de shipment_status menos las que escribe el propio
  sistema (se reconocen por sus notas: "Registro inicial", "Ingreso a bodega mediante
  desembarque", "Salida a ruta", "confirmado en inventario físico", "Cargado desde archivo F2",
  "Transferencia en ruta", "Cambio de tipo", "Entrega sin efecto").
- Ingreso de shipment por `shipmentId` (y por guía cuando el ingreso viejo no tiene
  shipmentId); el de una carga es el ingreso agrupado de su charge.
- Front: shadcn + Tailwind, textos en llano.

## Fuera de alcance
Acciones que cambien datos, consulta en vivo a FedEx/DHL (ya existe en otra pestaña).

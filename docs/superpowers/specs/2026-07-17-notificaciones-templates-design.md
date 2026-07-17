# Diseño — Finalización de plantillas de notificaciones

- **Fecha:** 2026-07-17
- **Branch:** `feat/template-engine-phase3`
- **Repos:** backend `pmy-api` + frontend `app-pmy`
- **Estado:** aprobado (brainstorming), pendiente plan de implementación

## Contexto

El branch introdujo el motor de plantillas (documents) que ya renderiza los correos
transaccionales desde `email-templates.seed.ts`. Quedan pendientes de terminar los
detalles de las **notificaciones** (correo + WhatsApp):

1. Los asuntos de correo deben ser descriptivos y consistentes (tipo, chofer, sucursal, día).
2. Todos los correos de reporte deben llevar número de seguimiento (cuando aplique) y un
   link "Ver en el sistema".
3. WhatsApp: hoy hay una sola plantilla (`messageTemplate`) y un número fijo (`driverPhone`)
   en `whatsapp_settings`. Se necesitan varias plantillas (salida a ruta, desembarque,
   inventario, reporte) y que el número se elija al enviar (custom / chofer / encargado).

## Decisiones tomadas (brainstorming)

| Decisión | Elección |
|---|---|
| Alcance | Backend (`pmy-api`) + Frontend (`app-pmy`) |
| Modelo de plantillas WhatsApp | Tabla propia `whatsapp_templates` (no el motor de documentos) |
| `driverPhone` fijo en config | Eliminarlo; el número se decide al enviar |
| Contenido WhatsApp | Aviso de evento con seguimiento + link al sistema |
| Link en correos | Ruta de módulo + `?seguimiento=` (no hay rutas de detalle por entidad) |
| Punto de envío WhatsApp | Componente reutilizable "Enviar notificación" por módulo |

## Hechos del código relevantes

- **Motor de correos**: `TemplateEngine` (Handlebars) aplana `data` + expone `brand` y
  `system` (`system.appUrl = process.env.FRONTEND_URL`). Helper `formatDate` (TZ
  America/Hermosillo). Bloques soportan `when: '<var>'` para render condicional
  (`src/documents/blocks/*`).
- **Correos**: `MailService` (`src/mail/mail.service.ts`) llama `templates.render(code, data)`
  por correo; ya recibe las entidades completas (dispatch/unloading/inventory/routeClosure/
  subsidiary), así que puede componer el `detailLink`.
- **Entidades**:
  - `route_dispatch`, `unloading`, `inventory` tienen `trackingNumber` propio (operación).
  - `RouteClosure` **no** tiene `trackingNumber`, pero sí `packageDispatch.trackingNumber` y
    `packageDispatch.drivers[]`.
  - Devoluciones procesa **múltiples** guías en lote → no hay seguimiento único.
  - `Driver.phoneNumber`; `Subsidiary.managerPhone` (encargado) y `Subsidiary.officeManager`.
- **WhatsApp**: `whatsapp_settings` es singleton con `enabled`, `driverPhone`,
  `messageTemplate`. Envío por `POST /whatsapp/send { message, to }` (gateway Baileys); si no
  se manda `to`, cae al `driverPhone`.
- **Frontend**: Next.js App Router. **No hay rutas de detalle por entidad**; solo listas:
  `/operaciones/salidas-a-ruta`, `/operaciones/desembarques`, `/operaciones/inventarios`,
  `/operaciones/devoluciones`, `/reportes`. Cierre de ruta vive como diálogo dentro de
  salidas-a-ruta. El envío WhatsApp existe solo en `send-driver-message.tsx` (monitor de
  rutas, número fijo a `driverPhone`, solo en paradas en riesgo). Config WhatsApp en
  `whatsapp-config-panel.tsx`.

---

## Sección 1 — Correos (`pmy-api`)

Archivo principal: `src/documents/seeds/email-templates.seed.ts` (+ `src/mail/mail.service.ts`
para las variables nuevas). El re-seed refresca versiones con `changelog` que empieza con
"Seed" (no pisa ediciones del usuario) — ya implementado en `seedEmailTemplates`.

### 1a. Asuntos

Patrón: `EMOJI TIPO - [chofer] - sucursal - fecha`. TIPO siempre; chofer obligatorio en
salida y cierre; sucursal cuando exista.

| code | subject nuevo |
|---|---|
| `route_dispatch` | `🚚 Salida a Ruta - {{driverName}} - {{subsidiaryName}} - {{formatDate createdAt}}` |
| `unloading` | `🚚 Desembarque - {{subsidiaryName}} - {{formatDate createdAt}}` |
| `route_closure` | `🚚 Cierre de Ruta - {{driverName}} - {{subsidiaryName}} - {{formatDate createdAt}}` |
| `inventory` | `📦 Inventario - {{subsidiaryName}} - {{formatDate inventoryDate}}` |
| `devolutions` | `🔄 Devoluciones/Recolecciones - {{subsidiaryName}} - {{formatDate createdAt}}` |
| `dex03_report` | `🚨🚥 Paquetes con status DEX03 de {{subsidiaryName}}` (sin cambio: ya cumple) |

> Nota: se conserva el `driverName` con fallback `'Sin chofer'` que ya arma `mail.service`.

### 1b. Número de seguimiento

- Salida / desembarque / inventario: ya lo llevan en `keyValue`. Sin cambio.
- **Cierre de ruta**: `mail.service` pasa `trackingNumber: routeClosure.packageDispatch?.trackingNumber`
  y se agrega la fila `keyValue` "Seguimiento" al seed + la variable declarada.
- **Devoluciones**: sin seguimiento único (lote). No se agrega.

### 1c. Link "Ver en el sistema"

Bloque `button` con `when: 'detailLink'` (texto "Ver en el sistema") al final de cada
reporte. `mail.service` compone el link completo y lo pasa como `detailLink`:

```
const base = (process.env.FRONTEND_URL ?? 'https://app-pmy.vercel.app').replace(/\/+$/, '');
detailLink = `${base}/operaciones/desembarques?seguimiento=${encodeURIComponent(trackingNumber)}`;
```

| code | detailLink |
|---|---|
| `route_dispatch` | `{base}/operaciones/salidas-a-ruta?seguimiento={tracking}` |
| `unloading` | `{base}/operaciones/desembarques?seguimiento={tracking}` |
| `inventory` | `{base}/operaciones/inventarios?seguimiento={tracking}` |
| `route_closure` | `{base}/operaciones/salidas-a-ruta?seguimiento={tracking}` |
| `devolutions` | `{base}/operaciones/devoluciones` |
| `dex03_report` | `{base}/reportes` |

Se agrega la variable `detailLink` a cada seed. El bloque `button` ya existe en
`BlockComposer`/`blocksToUnlayer`.

### Pruebas Sección 1

- Spec de `email-templates.seed.ts`: verifica que cada seed declara `detailLink` y que los
  subjects contienen tipo + (chofer donde aplica) + sucursal.
- Spec de `mail.service` (o del renderer): render de `route_closure` incluye seguimiento;
  render de cada reporte produce un `<a href>` con la ruta+query esperada.

---

## Sección 2 — Tabla `whatsapp_templates` (`pmy-api`)

### Entidad

`src/entities/whatsapp-template.entity.ts`:

```ts
@Entity('whatsapp_templates')
export class WhatsappTemplate {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ unique: true }) key: string;      // 'salida_ruta' | 'desembarque' | ...
  @Column() name: string;                      // nombre visible
  @Column({ type: 'text' }) body: string;      // con {placeholders}
  @Column({ default: true }) active: boolean;
  @Column({ type: 'datetime', nullable: true }) updatedAt: Date;
}
```

Registrar en `src/entities/index.ts` y en el módulo (nuevo `WhatsappTemplatesModule` o dentro
de `whatsapp-settings`).

### Servicio + Controller

- `WhatsappTemplatesService`: `list()`, `getByKey(key)`, `create(dto)`, `update(id, dto)`,
  `remove(id)`. Al guardar `body`, normaliza `updatedAt`.
- `WhatsappTemplatesController` (`/whatsapp-templates`): `GET` (autenticado), `POST`/`PUT`/
  `DELETE` (AdminGuard), siguiendo el patrón de `whatsapp-settings.controller.ts`.

### Seed / migración de datos

`src/whatsapp-templates/whatsapp-templates.seed.ts` (idempotente por `key`). Cinco plantillas:

- `prioridad_entrega` — **migración** del `DEFAULT_MESSAGE_TEMPLATE` actual (alerta Local Delay).
  Placeholders: `{cliente} {direccion} {cp} {guias} {vence} {ruta} {chofer}`.
- `salida_ruta`, `desembarque`, `inventario`, `reporte` — avisos de evento. Ejemplo:

```
🚚 *Salida a Ruta* — {sucursal}
Chofer: {chofer}
Fecha: {fecha}
Ruta(s): {ruta}
Seguimiento: {seguimiento}
Ver en el sistema: {link}
```

Placeholders soportados (subconjunto por plantilla): `{sucursal} {chofer} {fecha}
{seguimiento} {link} {ruta} {unidad}`.

> Si existe una fila previa en `whatsapp_settings.messageTemplate` distinta del default, el
> seed la usa como `body` de `prioridad_entrega` (preserva ediciones del usuario) antes de
> eliminar la columna.

### Pruebas Sección 2

- Spec del servicio: CRUD y upsert idempotente del seed por `key`.
- Spec del controller (o e2e mínimo): `GET` lista, escritura requiere admin.

---

## Sección 3 — `whatsapp_settings` y `/whatsapp/send` (`pmy-api`)

- Migración: **eliminar** columnas `driverPhone` y `messageTemplate` de `whatsapp_settings`
  (tras migrar `messageTemplate` a `prioridad_entrega`). La entidad queda con `enabled` +
  `updatedAt`. Ajustar `WhatsappSettingsService` (quitar defaults y normalización de
  `driverPhone`) y `whatsapp-defaults.ts` (eliminar `DEFAULT_DRIVER_PHONE`/
  `DEFAULT_MESSAGE_TEMPLATE`, o moverlos al seed de templates).
- `WhatsappGatewayController.send`: eliminar el fallback a `settings.driverPhone`. `to`
  obligatorio; si falta → `BadRequestException('Falta el número destino.')`.

### Pruebas Sección 3

- Spec del controller: `send` sin `to` → 400; con `to` → delega a `gateway.sendText`.
- Spec de `WhatsappSettingsService.get()`: crea singleton solo con `enabled`.

---

## Sección 4 — Frontend (`app-pmy`)

### 4a. Config WhatsApp — gestor de plantillas

`components/configuracion/whatsapp-config-panel.tsx`:

- **Quitar** los campos `driverPhone` y `messageTemplate`.
- Agregar un **gestor de plantillas** (lista + editor CRUD contra `/whatsapp-templates`):
  seleccionar plantilla, editar `name`/`body`, chips de placeholders, guardar/crear/eliminar,
  toggle `active`.
- Conservar `WhatsappConnectionCard` (estado, QR, prueba). El campo de prueba usa un número
  escrito por el usuario (ya no `driverPhone`).
- Nuevo servicio `lib/services/whatsapp-templates.ts` (list/create/update/remove).
- Ajustar `lib/services/whatsapp-settings.ts`: quitar `driverPhone`/`messageTemplate` del tipo
  y de `buildDriverMessage` (que pasará a recibir un `template.body` explícito).

### 4b. Componente reutilizable `EnviarNotificacion`

Generaliza `components/monitoreo/send-driver-message.tsx` a un dialog reutilizable
(`components/notificaciones/enviar-notificacion.tsx`):

- **Selector de plantilla** filtrado por módulo (carga `/whatsapp-templates` activas); rellena
  `{placeholders}` desde el contexto de la entidad que recibe por props.
- **Selector de número**: opciones `Custom` (input libre), `Chofer` (`driver.phoneNumber`),
  `Encargado` (`subsidiary.managerPhone`). Solo se listan las que tengan dato en contexto.
- Preview editable del mensaje + botón "Enviar por WhatsApp" → `POST /whatsapp/send { message, to }`.
- Se monta en: `/operaciones/salidas-a-ruta`, `/operaciones/desembarques`,
  `/operaciones/inventarios`, `/reportes`.
- El monitor de rutas (`route-monitor-board.tsx`) reusa este componente para la alerta de
  Local Delay (plantilla `prioridad_entrega`, número por defecto = chofer de la parada).

### 4c. Foco por seguimiento

Las páginas de lista `salidas-a-ruta`, `desembarques`, `inventarios` leen el query param
`?seguimiento=` (via `useSearchParams`) y, al cargar, resaltan / abren el registro cuyo
`trackingNumber` coincide (scroll + highlight, o abrir su diálogo de detalle). Devoluciones y
reportes solo navegan a la lista.

### Pruebas Sección 4

- Verificación manual guiada (Browser pane): editar una plantilla en config; abrir
  "Enviar notificación" en un módulo y confirmar selector de número + relleno de placeholders;
  abrir un correo con link y confirmar que `?seguimiento=` enfoca el registro.

---

## Riesgos / notas

- **Compatibilidad del monitor de rutas**: `send-driver-message` y `route-monitor-board`
  dependen hoy de `settings.driverPhone`/`messageTemplate`. Deben migrarse en el mismo cambio
  para no romper el envío existente.
- **Migración de datos**: preservar el `messageTemplate` editado por el usuario antes de
  soltar la columna.
- **`FRONTEND_URL`** debe estar configurado en producción para que los links de correo
  apunten al dominio correcto (hay fallback a `https://app-pmy.vercel.app`).
- **Sin nuevas rutas de detalle**: el "deep-link" es a la lista + query; el foco depende de la
  Sección 4c.

## Fuera de alcance

- Crear rutas de detalle `/<entidad>/[id]`.
- Cambiar el motor de documentos o la infraestructura de render.
- Refactors no relacionados con notificaciones.

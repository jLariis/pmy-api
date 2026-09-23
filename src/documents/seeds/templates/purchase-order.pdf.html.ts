/**
 * HTML-Handlebars de la Orden de Compra de mantenimiento (LETTER portrait).
 * Datos: `mapPurchaseOrderToPdf` (src/maintenance/dispatch/po-pdf.mapper.ts) + `brand.*` (company_settings/branding).
 * Solo trae las partidas aprobadas por el autorizador.
 */
export const PURCHASE_ORDER_PDF_HTML = `
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 10px; color: #1f2937; margin: 0; }
  .po { position: relative; padding: 4px 6px; }
  .po-watermark { position: fixed; top: 38%; left: 0; right: 0; text-align: center; font-size: 46px; font-weight: 800;
    color: rgba(220, 38, 38, 0.12); transform: rotate(-24deg); letter-spacing: 4px; z-index: 0; }
  .po-head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1e3a5f; padding-bottom: 10px; }
  .po-brand { display: flex; gap: 12px; align-items: center; max-width: 62%; }
  .po-brand img { max-height: 58px; max-width: 150px; object-fit: contain; }
  .po-company { line-height: 1.45; }
  .po-company .name { font-size: 13px; font-weight: 700; color: #1e3a5f; text-transform: uppercase; }
  .po-company .meta { color: #4b5563; font-size: 9px; }
  .po-box { border: 1.5px solid #1e3a5f; border-radius: 6px; min-width: 190px; overflow: hidden; text-align: center; }
  .po-box .t { background: #1e3a5f; color: #fff; font-weight: 700; letter-spacing: 1.5px; padding: 6px 10px; font-size: 11px; }
  .po-box .f { font-size: 16px; font-weight: 800; color: #1e3a5f; padding: 6px 10px 2px; font-family: 'Courier New', monospace; }
  .po-box .d { color: #4b5563; padding: 0 10px 7px; font-size: 9px; }
  .po-draft { margin-top: 8px; background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; text-align: center; padding: 5px; font-weight: 700; border-radius: 4px; }
  .po-grid { display: flex; gap: 10px; margin-top: 12px; }
  .po-card { flex: 1; border: 1px solid #d1d5db; border-radius: 6px; overflow: hidden; }
  .po-card .h { background: #eef2f7; color: #1e3a5f; font-weight: 700; font-size: 9px; letter-spacing: 1px; padding: 5px 8px; text-transform: uppercase; }
  .po-card .b { padding: 7px 8px; line-height: 1.55; }
  .po-card .b .k { color: #6b7280; display: inline-block; min-width: 62px; }
  .po-card .b .strong { font-weight: 700; font-size: 11px; }
  table.po-items { width: 100%; border-collapse: collapse; margin-top: 14px; position: relative; z-index: 1; }
  table.po-items th { background: #1e3a5f; color: #fff; font-size: 9px; text-transform: uppercase; letter-spacing: .6px; padding: 6px 7px; text-align: left; }
  table.po-items td { padding: 6px 7px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  table.po-items tr:nth-child(even) td { background: #f3f4f6; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .ctr { text-align: center; }
  .po-foot { display: flex; justify-content: space-between; gap: 14px; margin-top: 10px; }
  .po-words { flex: 1; border: 1px dashed #9ca3af; border-radius: 6px; padding: 8px; font-size: 9px; }
  .po-words .k { color: #6b7280; text-transform: uppercase; font-size: 8px; letter-spacing: .8px; }
  .po-words .v { font-weight: 700; margin-top: 3px; }
  table.po-totals { min-width: 220px; border-collapse: collapse; }
  table.po-totals td { padding: 4px 8px; }
  table.po-totals tr.total td { background: #1e3a5f; color: #fff; font-weight: 800; font-size: 12px; }
  .po-notes { margin-top: 12px; border-left: 3px solid #1e3a5f; background: #f9fafb; padding: 7px 10px; }
  .po-notes .k { font-weight: 700; color: #1e3a5f; margin-bottom: 2px; }
  .po-terms { margin-top: 10px; font-size: 8.5px; color: #4b5563; line-height: 1.5; }
  .po-sign { display: flex; justify-content: space-around; margin-top: 40px; text-align: center; }
  .po-sign .s { width: 38%; }
  .po-sign .line { border-top: 1px solid #111827; padding-top: 4px; font-weight: 700; }
  .po-sign .sub { color: #6b7280; font-size: 8.5px; }
  .po-bottom { margin-top: 22px; border-top: 1px solid #e5e7eb; padding-top: 6px; text-align: center; font-size: 8px; color: #6b7280; }
</style>
<div class="po">
  {{#if isDraft}}<div class="po-watermark">BORRADOR</div>{{/if}}

  <div class="po-head">
    <div class="po-brand">
      {{#if brand.logoLight}}<img src="{{brand.logoLight}}" alt="logo" />{{/if}}
      <div class="po-company">
        <div class="name">{{brand.fiscal.razonSocial}}</div>
        {{#if brand.fiscal.rfc}}<div class="meta">RFC: {{brand.fiscal.rfc}}</div>{{/if}}
        {{#if brand.fiscal.direccion}}<div class="meta">{{brand.fiscal.direccion}}</div>{{/if}}
        <div class="meta">
          {{#if brand.contact.phone}}Tel. {{brand.contact.phone}}{{/if}}
          {{#if brand.contact.email}} · {{brand.contact.email}}{{/if}}
        </div>
      </div>
    </div>
    <div class="po-box">
      <div class="t">{{title}}</div>
      <div class="f">{{folio}}</div>
      <div class="d">{{date}}</div>
      <div class="d">Sucursal: <b>{{subsidiaryName}}</b></div>
    </div>
  </div>
  {{#if isDraft}}<div class="po-draft">{{statusLabel}}</div>{{/if}}

  <div class="po-grid">
    <div class="po-card">
      <div class="h">Proveedor</div>
      <div class="b">
        <div class="strong">{{supplier.name}}</div>
        {{#if supplier.rfc}}<div><span class="k">RFC</span> {{supplier.rfc}}</div>{{/if}}
        {{#if supplier.address}}<div><span class="k">Dirección</span> {{supplier.address}}</div>{{/if}}
        {{#if contact.name}}<div><span class="k">Atención</span> {{contact.name}}</div>{{/if}}
        {{#if contact.email}}<div><span class="k">Correo</span> {{contact.email}}</div>{{/if}}
        {{#if contact.phone}}<div><span class="k">Teléfono</span> {{contact.phone}}</div>{{/if}}
      </div>
    </div>
    <div class="po-card">
      <div class="h">Unidad a atender</div>
      <div class="b">
        <div class="strong">{{vehicle.label}}</div>
        <div><span class="k">Placas</span> {{vehicle.plates}}</div>
        {{#if vehicle.brandModel}}<div><span class="k">Vehículo</span> {{vehicle.brandModel}}</div>{{/if}}
        {{#if vehicle.kms}}<div><span class="k">Kilometraje</span> {{vehicle.kms}}</div>{{/if}}
        {{#if requestFolio}}<div><span class="k">Solicitud</span> {{requestFolio}}</div>{{/if}}
      </div>
    </div>
  </div>

  <table class="po-items">
    <thead>
      <tr>
        <th class="ctr" style="width:28px">#</th>
        <th class="ctr" style="width:52px">Cant.</th>
        <th>Descripción</th>
        <th class="num" style="width:95px">P. unitario</th>
        <th class="num" style="width:100px">Importe</th>
      </tr>
    </thead>
    <tbody>
      {{#each rows}}
      <tr>
        <td class="ctr">{{index}}</td>
        <td class="ctr">{{quantity}}</td>
        <td>{{description}}</td>
        <td class="num">{{unitPrice}}</td>
        <td class="num">{{amount}}</td>
      </tr>
      {{/each}}
    </tbody>
  </table>

  <div class="po-foot">
    <div class="po-words">
      <div class="k">Importe con letra</div>
      <div class="v">{{totalInWords}}</div>
    </div>
    <table class="po-totals">
      <tr><td>Subtotal</td><td class="num">{{subtotal}}</td></tr>
      <tr><td>IVA</td><td class="num">{{tax}}</td></tr>
      <tr class="total"><td>TOTAL</td><td class="num">{{total}}</td></tr>
    </table>
  </div>

  {{#if hasNotes}}
  <div class="po-notes"><div class="k">Observaciones</div>{{notes}}</div>
  {{/if}}

  <div class="po-terms">
    <b>Condiciones:</b> Esta orden ampara únicamente los conceptos aquí listados. Cualquier trabajo adicional requiere
    una nueva autorización por escrito. Favor de hacer referencia al folio <b>{{folio}}</b> en su factura y enviarla a
    nombre de {{brand.fiscal.razonSocial}}{{#if brand.fiscal.rfc}} (RFC {{brand.fiscal.rfc}}){{/if}}.
  </div>

  <div class="po-sign">
    <div class="s">
      <div class="line">{{#if authorizedBy}}{{authorizedBy}}{{else}}&nbsp;{{/if}}</div>
      <div class="sub">Autorizó{{#if authorizedAt}} · {{authorizedAt}}{{/if}}</div>
    </div>
    <div class="s">
      <div class="line">{{supplier.name}}</div>
      <div class="sub">Recibido por el proveedor</div>
    </div>
  </div>

  <div class="po-bottom">
    {{brand.fiscal.razonSocial}}{{#if brand.contact.website}} · {{brand.contact.website}}{{/if}} · Documento generado por PMY App
  </div>
</div>
`;

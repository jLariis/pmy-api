/**
 * HTML-Handlebars de la "Solicitud de cotización" que Compras manda a los proveedores (LETTER portrait).
 * Datos: `mapRequestToRfqPdf` (src/maintenance/dispatch/rfq-pdf.mapper.ts) + `brand.*`.
 * Deja en blanco precio/existencia para que el proveedor los llene.
 */
export const REQUEST_QUOTE_PDF_HTML = `
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 10px; color: #1f2937; margin: 0; }
  .rq { padding: 4px 6px; }
  .rq-head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1e3a5f; padding-bottom: 10px; }
  .rq-brand { display: flex; gap: 12px; align-items: center; max-width: 62%; }
  .rq-brand img { max-height: 58px; max-width: 150px; object-fit: contain; }
  .rq-company .name { font-size: 13px; font-weight: 700; color: #1e3a5f; text-transform: uppercase; }
  .rq-company .meta { color: #4b5563; font-size: 9px; line-height: 1.45; }
  .rq-box { border: 1.5px solid #1e3a5f; border-radius: 6px; min-width: 200px; overflow: hidden; text-align: center; }
  .rq-box .t { background: #1e3a5f; color: #fff; font-weight: 700; letter-spacing: 1.2px; padding: 6px 10px; font-size: 11px; }
  .rq-box .f { font-size: 16px; font-weight: 800; color: #1e3a5f; padding: 6px 10px 2px; font-family: 'Courier New', monospace; }
  .rq-box .d { color: #4b5563; padding: 0 10px 7px; font-size: 9px; }
  .rq-grid { display: flex; gap: 10px; margin-top: 12px; }
  .rq-card { flex: 1; border: 1px solid #d1d5db; border-radius: 6px; overflow: hidden; }
  .rq-card .h { background: #eef2f7; color: #1e3a5f; font-weight: 700; font-size: 9px; letter-spacing: 1px; padding: 5px 8px; text-transform: uppercase; }
  .rq-card .b { padding: 7px 8px; line-height: 1.55; }
  .rq-card .k { color: #6b7280; display: inline-block; min-width: 62px; }
  .rq-card .strong { font-weight: 700; font-size: 11px; }
  .rq-intro { margin-top: 12px; line-height: 1.5; }
  table.rq-items { width: 100%; border-collapse: collapse; margin-top: 10px; }
  table.rq-items th { background: #1e3a5f; color: #fff; font-size: 9px; text-transform: uppercase; letter-spacing: .6px; padding: 6px 7px; text-align: left; }
  table.rq-items td { padding: 7px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  table.rq-items tr:nth-child(even) td { background: #f3f4f6; }
  table.rq-items td.fill { border-left: 1px dashed #cbd5e1; }
  .sub { color: #6b7280; font-size: 8.5px; }
  .ctr { text-align: center; }
  .rq-ask { margin-top: 12px; border-left: 3px solid #1e3a5f; background: #f9fafb; padding: 8px 10px; line-height: 1.6; }
  .rq-ask .k { font-weight: 700; color: #1e3a5f; margin-bottom: 2px; }
  .rq-notes { margin-top: 10px; border: 1px dashed #9ca3af; border-radius: 6px; padding: 8px; }
  .rq-bottom { margin-top: 22px; border-top: 1px solid #e5e7eb; padding-top: 6px; text-align: center; font-size: 8px; color: #6b7280; }
</style>
<div class="rq">
  <div class="rq-head">
    <div class="rq-brand">
      {{#if brand.logoLight}}<img src="{{brand.logoLight}}" alt="logo" />{{/if}}
      <div class="rq-company">
        <div class="name">{{brand.fiscal.razonSocial}}</div>
        {{#if brand.fiscal.rfc}}<div class="meta">RFC: {{brand.fiscal.rfc}}</div>{{/if}}
        {{#if brand.fiscal.direccion}}<div class="meta">{{brand.fiscal.direccion}}</div>{{/if}}
      </div>
    </div>
    <div class="rq-box">
      <div class="t">SOLICITUD DE COTIZACIÓN</div>
      <div class="f">{{folio}}</div>
      <div class="d">{{date}}</div>
      <div class="d">Sucursal: <b>{{subsidiaryName}}</b></div>
    </div>
  </div>

  <div class="rq-grid">
    <div class="rq-card">
      <div class="h">Para</div>
      <div class="b">
        <div class="strong">{{supplier.name}}</div>
        {{#if contact.name}}<div><span class="k">Atención</span> {{contact.name}}</div>{{/if}}
        {{#if contact.email}}<div><span class="k">Correo</span> {{contact.email}}</div>{{/if}}
        {{#if contact.phone}}<div><span class="k">Teléfono</span> {{contact.phone}}</div>{{/if}}
      </div>
    </div>
    <div class="rq-card">
      <div class="h">{{#if vehicle.label}}Unidad{{else}}Detalle{{/if}}</div>
      <div class="b">
        {{#if vehicle.label}}
        <div class="strong">{{vehicle.label}}</div>
        {{#if vehicle.brandModel}}<div><span class="k">Vehículo</span> {{vehicle.brandModel}}</div>{{/if}}
        {{#if vehicle.plates}}<div><span class="k">Placas</span> {{vehicle.plates}}</div>{{/if}}
        {{/if}}
        <div><span class="k">Tipo</span> {{requestType}}</div>
        <div><span class="k">Responder a</span> {{requestedBy}}{{#if replyTo}} · {{replyTo}}{{/if}}</div>
      </div>
    </div>
  </div>

  <div class="rq-intro">
    Le solicitamos de la manera más atenta su cotización por los siguientes conceptos{{#if description}} — <b>{{description}}</b>{{/if}}:
  </div>

  <table class="rq-items">
    <thead>
      <tr>
        <th class="ctr" style="width:26px">#</th>
        <th class="ctr" style="width:56px">Cant.</th>
        <th>Descripción</th>
        <th style="width:95px">P. unitario</th>
        <th style="width:95px">Existencia</th>
      </tr>
    </thead>
    <tbody>
      {{#each rows}}
      <tr>
        <td class="ctr">{{index}}</td>
        <td class="ctr">{{quantity}}{{#if unit}}<div class="sub">{{unit}}</div>{{/if}}</td>
        <td>{{description}}{{#if detail}}<div class="sub">{{detail}}</div>{{/if}}</td>
        <td class="fill">&nbsp;</td>
        <td class="fill">&nbsp;</td>
      </tr>
      {{/each}}
    </tbody>
  </table>

  <div class="rq-ask">
    <div class="k">Por favor indíquenos en su cotización:</div>
    · Precio unitario de cada concepto y si incluye IVA / IEPS.<br/>
    · Si lo tiene en existencia o, si es sobre pedido, en cuántos días lo entrega.<br/>
    · Marca y número de parte cuando aplique, y vigencia de la cotización.
  </div>

  {{#if hasNotes}}<div class="rq-notes"><b>Notas:</b> {{notes}}</div>{{/if}}

  <div class="rq-bottom">
    Esta solicitud no es una orden de compra. {{brand.fiscal.razonSocial}} · Documento generado por PMY App
  </div>
</div>
`;

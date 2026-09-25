/**
 * HTML-Handlebars del "Comparativo de cotizaciones" por partida (LETTER landscape).
 * Datos: `mapComparisonToPdf` (src/maintenance/dispatch/comparison-pdf.mapper.ts) + `brand.*`.
 * Una columna por proveedor; resalta el mejor precio con existencia y marca lo elegido.
 */
export const PURCHASE_COMPARISON_PDF_HTML = `
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 9.5px; color: #1f2937; margin: 0; }
  .cmp-head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1e3a5f; padding-bottom: 8px; }
  .cmp-brand { display: flex; gap: 12px; align-items: center; }
  .cmp-brand img { max-height: 48px; max-width: 140px; object-fit: contain; }
  .cmp-brand .name { font-size: 13px; font-weight: 700; color: #1e3a5f; text-transform: uppercase; }
  .cmp-brand .meta { color: #4b5563; font-size: 9px; }
  .cmp-box { border: 1.5px solid #1e3a5f; border-radius: 6px; min-width: 220px; overflow: hidden; text-align: center; }
  .cmp-box .t { background: #1e3a5f; color: #fff; font-weight: 700; letter-spacing: 1.2px; padding: 5px 10px; font-size: 10.5px; }
  .cmp-box .f { font-size: 14px; font-weight: 800; color: #1e3a5f; padding: 5px 10px 1px; font-family: 'Courier New', monospace; }
  .cmp-box .d { color: #4b5563; padding: 0 10px 6px; font-size: 9px; }
  .cmp-info { margin-top: 8px; color: #374151; }
  table.cmp { width: 100%; border-collapse: collapse; margin-top: 10px; }
  table.cmp th { background: #1e3a5f; color: #fff; font-size: 8.5px; text-transform: uppercase; letter-spacing: .5px; padding: 5px 6px; text-align: left; vertical-align: bottom; }
  table.cmp th.sup { text-align: center; border-left: 1px solid #3b5b85; }
  table.cmp td { padding: 5px 6px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  table.cmp td.cell { text-align: center; border-left: 1px solid #e5e7eb; }
  table.cmp td.best { background: #ecfdf5; }
  table.cmp td.sel { outline: 2px solid #1e3a5f; outline-offset: -2px; }
  table.cmp td.none { color: #9ca3af; }
  table.cmp tfoot td { background: #eef2f7; font-weight: 700; }
  .price { font-weight: 700; font-variant-numeric: tabular-nums; }
  .sub { color: #6b7280; font-size: 8px; }
  .no { color: #b91c1c; font-size: 8px; font-weight: 700; }
  .mark { color: #1e3a5f; font-weight: 800; font-size: 8px; }
  .ctr { text-align: center; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .legend { margin-top: 8px; font-size: 8.5px; color: #4b5563; }
  .legend span { display: inline-block; width: 10px; height: 10px; vertical-align: middle; margin: 0 3px 0 10px; }
  table.sum { margin-top: 12px; border-collapse: collapse; min-width: 50%; }
  table.sum th { background: #eef2f7; color: #1e3a5f; font-size: 8.5px; text-transform: uppercase; padding: 5px 8px; text-align: left; }
  table.sum td { padding: 5px 8px; border-bottom: 1px solid #e5e7eb; }
  table.sum tr.total td { background: #1e3a5f; color: #fff; font-weight: 800; }
  .cmp-bottom { margin-top: 16px; border-top: 1px solid #e5e7eb; padding-top: 5px; text-align: center; font-size: 8px; color: #6b7280; }
</style>
<div>
  <div class="cmp-head">
    <div class="cmp-brand">
      {{#if brand.logoLight}}<img src="{{brand.logoLight}}" alt="logo" />{{/if}}
      <div>
        <div class="name">{{brand.fiscal.razonSocial}}</div>
        {{#if brand.fiscal.rfc}}<div class="meta">RFC: {{brand.fiscal.rfc}}</div>{{/if}}
      </div>
    </div>
    <div class="cmp-box">
      <div class="t">COMPARATIVO DE COTIZACIONES</div>
      <div class="f">{{folio}}</div>
      <div class="d">{{date}} · {{subsidiaryName}}</div>
    </div>
  </div>

  <div class="cmp-info">
    <b>{{requestType}}</b>{{#if vehicleLabel}} · Unidad <b>{{vehicleLabel}}</b>{{/if}} · {{description}}
  </div>

  <table class="cmp">
    <thead>
      <tr>
        <th style="width:22px">#</th>
        <th>Concepto</th>
        <th class="ctr" style="width:48px">Cant.</th>
        {{#each suppliers}}<th class="sup">{{name}}</th>{{/each}}
      </tr>
    </thead>
    <tbody>
      {{#each rows}}
      <tr>
        <td class="ctr">{{index}}</td>
        <td>{{description}}</td>
        <td class="ctr">{{quantity}}{{#if unit}}<div class="sub">{{unit}}</div>{{/if}}</td>
        {{#each cells}}
        <td class="cell {{cls}}">
          {{#if has}}
            <div class="price">{{unitPrice}}</div>
            <div class="sub">Importe {{total}}</div>
            {{#if noStock}}<div class="no">SIN EXISTENCIA</div>{{else}}<div class="sub">{{availability}}</div>{{/if}}
            {{#if quality}}<div class="sub">Calidad {{quality}}</div>{{/if}}
            {{#if selected}}<div class="mark">✔ ELEGIDO</div>{{/if}}
          {{else}}—{{/if}}
        </td>
        {{/each}}
      </tr>
      {{/each}}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="3">Total cotizado (con impuestos)</td>
        {{#each suppliers}}<td class="cell">{{total}}<div class="sub">cubre {{covered}}</div></td>{{/each}}
      </tr>
    </tfoot>
  </table>

  <div class="legend">
    <span style="background:#ecfdf5;border:1px solid #a7f3d0"></span>Mejor precio con existencia
    <span style="border:2px solid #1e3a5f"></span>Proveedor elegido
  </div>

  {{#if hasSelection}}
  <table class="sum">
    <thead><tr><th>Órdenes a generar</th><th class="ctr">Conceptos</th><th class="num">Total</th></tr></thead>
    <tbody>
      {{#each selection}}<tr><td>{{name}}</td><td class="ctr">{{count}}</td><td class="num">{{total}}</td></tr>{{/each}}
      <tr class="total"><td>TOTAL</td><td class="ctr">{{selectionCount}}</td><td class="num">{{selectionTotal}}</td></tr>
    </tbody>
  </table>
  {{/if}}

  <div class="cmp-bottom">Elaboró: {{preparedBy}} · {{brand.fiscal.razonSocial}} · Documento generado por PMY App</div>
</div>
`;

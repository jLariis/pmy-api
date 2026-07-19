/** HTML-Handlebars fiel a C5 (frontend `InventoryPDFReport`, "Inventario"). */
export const INVENTORY_PDF_HTML = `
<style>
  body { font-size: 8px; color: #212529; }
  .inv-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; padding-bottom:8px; border-bottom:2px solid #8c5e4e; }
  .inv-header img { width:45px; height:45px; }
  .inv-title { font-size:14px; font-weight:bold; color:#8c5e4e; text-align:center; flex:1; }
  .inv-date { font-size:8px; color:#212529; text-align:right; }
  .inv-grid { display:flex; flex-wrap:wrap; justify-content:space-between; margin-bottom:10px; padding:8px; background:#f8f9fa; border:1px solid #dee2e6; border-radius:4px; }
  .inv-grid .cell { width:32%; margin-bottom:5px; }
  .inv-lbl { font-size:7px; font-weight:bold; color:#8c5e4e; margin-bottom:2px; }
  .inv-val { font-size:8px; color:#212529; font-weight:bold; }
  .inv-section-title { font-size:10px; font-weight:bold; color:#8c5e4e; margin-bottom:6px; padding:4px; text-align:center; background:#f8f9fa; border:1px solid #dee2e6; border-radius:3px; }
  table { width:100%; border-collapse:collapse; border:1px solid #dee2e6; border-radius:4px; margin-bottom:10px; }
  thead th { background:#8c5e4e; color:#fff; padding:4px 2px; font-size:7px; font-weight:bold; text-align:left; }
  tbody td { padding:3px 2px; border-bottom:1px solid #dee2e6; font-size:7px; }
  tbody tr.even td { background:#f8f9fa; }
  .badge { font-size:6px; font-weight:bold; padding:1px 2px; border-radius:2px; margin-right:1px; color:#fff; }
  .badge-c { background:#40c057; }
  .badge-p { background:#f59f00; }
  .badge-h { background:#e03131; }
  .inv-stats { display:flex; justify-content:space-between; margin-top:12px; flex-wrap:wrap; }
  .inv-statbox { width:23%; border:1px solid #8c5e4e; border-radius:3px; padding:6px; text-align:center; margin-bottom:5px; background:#f8f9fa; }
  .inv-stat-lbl { font-size:7px; font-weight:bold; color:#8c5e4e; margin-bottom:2px; }
  .inv-stat-val { font-size:12px; font-weight:bold; color:#212529; }
  .inv-lists { margin-top:12px; }
  .inv-list { display:inline-block; vertical-align:top; width:48%; }
  .inv-list-item { font-size:7px; margin-bottom:2px; padding:2px; border-bottom:1px solid #dee2e6; }
  .inv-list-more { font-style:italic; }
  .inv-signatures { display:flex; justify-content:space-between; margin-top:15px; border-top:1px solid #dee2e6; padding-top:10px; }
  .inv-sig { width:48%; text-align:center; }
  .inv-sig-line { border-top:1px solid #212529; width:80%; margin:0 auto 3px; padding-top:3px; }
  .inv-sig-text { font-size:9px; font-weight:bold; color:#212529; }
  .inv-sig-sub { font-size:8px; color:#212529; margin-top:2px; }
  .inv-footer { margin-top:10px; font-size:7px; color:#212529; text-align:center; border-top:1px solid #dee2e6; padding-top:4px; opacity:0.7; }
</style>
<div class="inv-header">
  {{#if brand.logoLight}}<img src="{{brand.logoLight}}" />{{else}}<span></span>{{/if}}
  <div class="inv-title">INVENTARIO DE PAQUETES</div>
  <div class="inv-date">{{generatedDate}}<br/>{{generatedTime}}</div>
</div>
<div class="inv-grid">
  <div class="cell"><div class="inv-lbl">SUCURSAL</div><div class="inv-val">{{subsidiaryName}}</div></div>
  <div class="cell"><div class="inv-lbl">FECHA INVENTARIO</div><div class="inv-val">{{inventoryDate}}</div></div>
  <div class="cell"><div class="inv-lbl">TOTAL PAQUETES</div><div class="inv-val">{{totalPackages}}</div></div>
  <div class="cell"><div class="inv-lbl">VÁLIDOS</div><div class="inv-val">{{stats.valid}}</div></div>
  <div class="cell"><div class="inv-lbl">CARGA</div><div class="inv-val">{{stats.carga}}</div></div>
  <div class="cell"><div class="inv-lbl">ALTO VALOR</div><div class="inv-val">{{stats.highValue}}</div></div>
</div>
<div class="inv-section-title">PAQUETES DEL INVENTARIO ({{totalPackages}})</div>
<table>
  <thead><tr>
    <th style="width:25px">#</th><th style="width:80px">GUÍA</th><th style="width:100px">NOMBRE</th>
    <th style="width:110px">DIRECCIÓN</th><th style="width:50px">CP</th><th style="width:70px">COBRO</th>
    <th style="width:60px">FECHA</th><th style="width:50px">HORA</th>
  </tr></thead>
  <tbody>
    {{#each rows}}
    <tr class="{{rowClass}}">
      <td>{{#if isCharge}}<span class="badge badge-c">C</span>{{/if}}{{#if hasPayment}}<span class="badge badge-p">$</span>{{/if}}{{#if isHighValue}}<span class="badge badge-h">H</span>{{/if}}{{index}}</td>
      <td>{{trackingNumber}}</td><td>{{recipientName}}</td><td>{{recipientAddress}}</td>
      <td>{{recipientZip}}</td><td>{{payment}}</td><td>{{date}}</td><td>{{time}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>
<div class="inv-stats">
  <div class="inv-statbox"><div class="inv-stat-lbl">TOTAL PAQUETES</div><div class="inv-stat-val">{{totalPackages}}</div></div>
  <div class="inv-statbox"><div class="inv-stat-lbl">VÁLIDOS</div><div class="inv-stat-val">{{stats.valid}}</div></div>
  <div class="inv-statbox"><div class="inv-stat-lbl">PAQUETES CARGA</div><div class="inv-stat-val">{{stats.carga}}</div></div>
  <div class="inv-statbox"><div class="inv-stat-lbl">ALTO VALOR</div><div class="inv-stat-val">{{stats.highValue}}</div></div>
</div>
<div class="inv-lists">
  {{#if hasMissing}}
  <div class="inv-list">
    <div class="inv-section-title">GUIAS FALTANTES ({{missingTrackings.length}})</div>
    {{#each missingPreview}}<div class="inv-list-item">{{this}}</div>{{/each}}
    {{#if hasMissingExtra}}<div class="inv-list-item inv-list-more">...y {{missingExtra}} más</div>{{/if}}
  </div>
  {{/if}}
  {{#if hasUnScanned}}
  <div class="inv-list">
    <div class="inv-section-title">GUIAS SIN ESCANEO ({{unScannedTrackings.length}})</div>
    {{#each unScannedPreview}}<div class="inv-list-item">{{this}}</div>{{/each}}
    {{#if hasUnScannedExtra}}<div class="inv-list-item inv-list-more">...y {{unScannedExtra}} más</div>{{/if}}
  </div>
  {{/if}}
</div>
<div class="inv-signatures">
  <div class="inv-sig">
    <div class="inv-sig-line"></div>
    <div class="inv-sig-text">RESPONSABLE DE INVENTARIO</div>
    <div class="inv-sig-sub">Nombre y firma</div>
  </div>
  <div class="inv-sig">
    <div class="inv-sig-line"></div>
    <div class="inv-sig-text">SUPERVISOR</div>
    <div class="inv-sig-sub">Nombre y firma</div>
  </div>
</div>
<div class="inv-footer">
  <div>Documento generado automáticamente por el Sistema de Gestión de Inventarios</div>
  <div>Impreso el {{generatedDate}} a las {{generatedTime}}</div>
</div>
`;

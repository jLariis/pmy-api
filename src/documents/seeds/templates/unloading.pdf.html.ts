/** HTML-Handlebars fiel a C3 (frontend `UnloadingPDFReport`, "Desembarque"). */
export const UNLOADING_PDF_HTML = `
<style>
  body { font-size: 9px; color: #212529; }
  .un-header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px; padding-bottom:4px; border-bottom:1px solid #9d5137; }
  .un-header img { width:60px; height:60px; }
  .un-title { font-size:16px; font-weight:bold; color:#9d5137; margin-bottom:4px; }
  .un-info-label { font-size:9px; font-weight:bold; margin-bottom:2px; }
  .un-info-row { font-size:9px; margin-bottom:1px; }
  .un-info-row b { padding-right:3px; }
  .un-fecha { font-size:9px; margin-top:2px; }
  .un-section { display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; }
  .un-sym { font-size:9px; }
  .un-seguimiento { font-size:9px; font-weight:bold; }
  table { width:100%; border-collapse:collapse; }
  thead th { background:#9d5137; color:#fff; padding:4px; font-size:9px; font-weight:bold; text-align:left; }
  tbody td { padding:3px 4px; border-bottom:1px solid #ccc; font-size:9px; }
  .un-extra { margin-top:10px; border-top:1px solid #ccc; padding-top:4px; }
  .un-extra-title { font-size:11px; font-weight:bold; margin-bottom:4px; }
  .un-extra-row { font-size:9px; padding:3px 4px; border-bottom:1px solid #ccc; display:flex; gap:8px; }
</style>
<div class="un-header">
  <div>
    <div class="un-title">Desembarque</div>
    <div class="un-info-label">Información</div>
    <div class="un-info-row"><b>Sucursal:</b>{{subsidiaryName}}</div>
    <div class="un-info-row"><b>Unidad:</b>{{vehicleName}}</div>
    <div class="un-info-row"><b>No. Paquetes:</b>{{totalPackages}}</div>
    <div class="un-fecha">Fecha: {{nowDateTime}}</div>
  </div>
  {{#if brand.logoLight}}<img src="{{brand.logoLight}}" />{{else}}<span></span>{{/if}}
</div>
<div class="un-section">
  <div class="un-sym">Simbología: [C] Carga/F2/31.5 [$] Pago [H] Valor alto</div>
  <div class="un-seguimiento">Número de seguimiento: {{trackingNumber}}</div>
</div>
<table>
  <thead><tr>
    <th style="width:25px">[#]</th><th style="width:63px">No. Guía</th><th style="width:175px">Nombre</th>
    <th style="width:185px">Dirección</th><th style="width:40px">C.P.</th><th style="width:55px">Cobro</th>
    <th style="width:55px">Fecha</th><th style="width:45px">Hora</th><th style="width:50px">Celular</th>
  </tr></thead>
  <tbody>
    {{#each rows}}
    <tr>
      <td>{{icons}} {{index}}</td><td>{{trackingNumber}}</td><td>{{recipientName}}</td>
      <td>{{recipientAddress}}</td><td>{{recipientZip}}</td><td>{{payment}}</td>
      <td>{{date}}</td><td>{{time}}</td><td>{{recipientPhone}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>
{{#if hasMissing}}
<div class="un-extra">
  <div class="un-extra-title">* Guías faltantes</div>
  {{#each missingRows}}
  <div class="un-extra-row">
    <span style="width:70px">{{trackingNumber}}</span>
    <span style="width:175px">{{recipientName}}</span>
    <span style="width:185px">{{recipientAddress}}</span>
    <span style="width:50px">{{recipientZip}}</span>
    <span style="width:50px">{{recipientPhone}}</span>
  </div>
  {{/each}}
</div>
{{/if}}
{{#if hasUnScanned}}
<div class="un-extra">
  <div class="un-extra-title">** Guías sobrantes</div>
  {{#each unScannedTrackings}}
  <div class="un-extra-row"><span>{{this}}</span></div>
  {{/each}}
</div>
{{/if}}
`;

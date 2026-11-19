/**
 * HTML-Handlebars de "Desembarque" (diseño aprobado 2026-11-18).
 * Encabezado tipo membrete: logo a la IZQUIERDA, título + folio, y los datos en una rejilla de
 * 3 columnas (no apilados). La tabla, la simbología y las secciones de faltantes/sobrantes son
 * iguales al PDF del frontend (`UnloadingPDFReport`). El pie con "Página X de N" va en
 * `UNLOADING_PDF_FOOTER` (lo dibuja Chromium en el margen inferior de cada hoja).
 */
export const UNLOADING_PDF_HTML = `
<style>
  body { font-size: 9px; color: #212529; font-family: Helvetica, Arial, sans-serif; }
  .un-head { display:flex; align-items:center; gap:18px; padding-bottom:10px; margin-bottom:10px; border-bottom:2px solid #9d5137; }
  .un-brand { display:flex; align-items:center; gap:12px; padding-right:18px; border-right:1px solid #e3d3cc; }
  .un-brand img { height:56px; width:auto; }
  .un-title { font-size:18px; font-weight:bold; color:#9d5137; line-height:1.1; }
  .un-folio { font-size:10px; color:#6c757d; margin-top:4px; }
  .un-folio b { font-size:13px; color:#212529; letter-spacing:0.3px; }
  .un-grid { flex:1; display:grid; grid-template-columns:repeat(3, 1fr); column-gap:24px; row-gap:8px; }
  .un-k { font-size:7.5px; font-weight:bold; color:#9d5137; text-transform:uppercase; letter-spacing:0.6px; }
  .un-v { font-size:10px; font-weight:bold; color:#212529; margin-top:1px; }
  .un-sym { font-size:8.5px; color:#495057; margin-bottom:6px; }
  table { width:100%; border-collapse:collapse; }
  thead { display:table-header-group; }
  tr { page-break-inside:avoid; }
  thead th { background:#9d5137; color:#fff; padding:4px; font-size:9px; font-weight:bold; text-align:left; }
  tbody td { padding:3px 4px; border-bottom:1px solid #ccc; font-size:9px; }
  .un-idx { white-space:nowrap; }
  .un-extra { margin-top:12px; border-top:1px solid #ccc; padding-top:6px; }
  .un-extra-title { font-size:11px; font-weight:bold; color:#9d5137; margin-bottom:4px; }
  .un-extra-row { font-size:9px; padding:3px 4px; border-bottom:1px solid #ccc; display:flex; gap:8px; }
</style>
<div class="un-head">
  <div class="un-brand">
    {{#if brand.logoLight}}<img src="{{brand.logoLight}}" />{{else}}{{#if logoSrc}}<img src="{{logoSrc}}" />{{/if}}{{/if}}
    <div>
      <div class="un-title">Desembarque</div>
      <div class="un-folio">Folio <b>{{trackingNumber}}</b></div>
    </div>
  </div>
  <div class="un-grid">
    <div><div class="un-k">Sucursal</div><div class="un-v">{{subsidiaryName}}</div></div>
    <div><div class="un-k">Unidad</div><div class="un-v">{{vehicleName}}</div></div>
    <div><div class="un-k">Paquetes</div><div class="un-v">{{totalPackages}}</div></div>
    <div><div class="un-k">Fecha</div><div class="un-v">{{createdDateTime}}</div></div>
    <div><div class="un-k">Hecho por</div><div class="un-v">{{createdByName}}</div></div>
    <div><div class="un-k">Faltantes / sobrantes</div><div class="un-v">{{missingSummary}}</div></div>
  </div>
</div>
<div class="un-sym">Simbología: [C] Carga/F2/31.5 · [$] Pago · [H] Valor alto</div>
<table>
  <thead><tr>
    <th style="width:38px">[#]</th><th style="width:63px">No. Guía</th><th style="width:162px">Nombre</th>
    <th style="width:185px">Dirección</th><th style="width:40px">C.P.</th><th style="width:55px">Cobro</th>
    <th style="width:55px">Fecha</th><th style="width:45px">Hora</th><th style="width:50px">Celular</th>
  </tr></thead>
  <tbody>
    {{#each rows}}
    <tr>
      <td class="un-idx">{{icons}} {{index}}</td><td>{{trackingNumber}}</td><td>{{recipientName}}</td>
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

/** Pie de cada hoja (plantilla de Chromium: estilos en línea; pageNumber/totalPages los llena Chromium). */
export const UNLOADING_PDF_FOOTER = `
<div style="width:100%; font-size:7.5px; color:#6c757d; font-family:Helvetica, Arial, sans-serif; padding:0 22px; display:flex; justify-content:space-between;">
  <span>Paquetería y Mensajería del Yaqui · Generado {{nowDateTime}}</span>
  <span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span>
</div>
`;

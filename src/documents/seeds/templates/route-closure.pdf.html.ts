/** HTML-Handlebars fiel a C7 (frontend `RouteClosurePDF`, "Cierre de Ruta"). LETTER portrait, 2 columnas (flex). */
export const ROUTE_CLOSURE_PDF_HTML = `
<style>
  body { font-size: 8px; color: #212529; }
  .rc-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; padding-bottom:6px; border-bottom:2px solid #8c5e4e; }
  .rc-header img { width:45px; height:45px; }
  .rc-title { font-size:13px; font-weight:bold; color:#8c5e4e; text-align:center; }
  .rc-date { font-size:7px; color:#212529; text-align:right; }
  .rc-grid { display:flex; flex-wrap:wrap; justify-content:space-between; margin-bottom:8px; padding:6px; background:#f8f9fa; border-radius:4px; border:1px solid #dee2e6; }
  .rc-grid .cell { width:32%; margin-bottom:4px; }
  .rc-lbl { font-size:6px; font-weight:bold; color:#8c5e4e; margin-bottom:1px; }
  .rc-val { font-size:7px; color:#212529; }
  .rc-main { display:flex; justify-content:space-between; margin-bottom:8px; }
  .rc-left { width:58%; padding-right:8px; }
  .rc-right { width:40%; }
  .rc-section-title { font-size:9px; font-weight:bold; color:#8c5e4e; margin-bottom:5px; padding:3px; text-align:center; background:#f8f9fa; border-radius:3px; border:1px solid #dee2e6; }
  .rc-empty { text-align:center; font-size:7px; padding:8px; }
  table.rc-table { width:100%; border-collapse:collapse; border:1px solid #dee2e6; border-radius:4px; margin-bottom:8px; }
  table.rc-table thead th { background:#8c5e4e; color:#fff; padding:3px; font-size:7px; font-weight:bold; text-align:left; }
  table.rc-table tbody td { padding:2px; border-bottom:1px solid #dee2e6; font-size:6.5px; }
  table.rc-table tbody tr.even td { background:#f8f9fa; }
  .rc-dex-container { display:flex; justify-content:space-between; flex-wrap:wrap; margin-bottom:6px; }
  .rc-dex-box { width:23%; border:1px solid #dee2e6; border-radius:2px; padding:4px; text-align:center; margin-bottom:4px; background:#f8f9fa; }
  .rc-dex-title { font-size:7px; font-weight:bold; color:#8c5e4e; margin-bottom:1px; }
  .rc-dex-value { font-size:9px; font-weight:bold; color:#212529; }
  .rc-collections { border:1px solid #dee2e6; border-radius:4px; padding:4px; margin-bottom:8px; }
  .rc-collections-grid { display:flex; flex-wrap:wrap; justify-content:flex-start; }
  .rc-collection-item { width:48%; font-size:7px; margin-bottom:2px; padding:2px; border-bottom:1px solid #dee2e6; }
  .rc-stats { display:flex; justify-content:space-between; flex-wrap:wrap; margin-top:6px; }
  .rc-stat-box { width:48%; border:1px solid #8c5e4e; border-radius:3px; padding:5px; text-align:center; margin-bottom:5px; background:#f8f9fa; }
  .rc-stat-title { font-size:7px; font-weight:bold; color:#8c5e4e; margin-bottom:2px; }
  .rc-stat-value { font-size:11px; font-weight:bold; color:#212529; }
  .rc-stat-value.high { color:#ff6b6b; }
  .rc-stat-value.ok { color:#40c057; }
  .rc-stat-value.secondary { color:#4cc9f0; }
  .rc-signatures { display:flex; justify-content:space-between; margin-top:12px; border-top:1px solid #dee2e6; padding-top:8px; }
  .rc-sig { width:48%; text-align:center; }
  .rc-sig-line { border-top:1px solid #212529; width:80%; margin:0 auto 3px; padding-top:3px; }
  .rc-sig-text { font-size:8px; font-weight:bold; text-align:center; }
  .rc-sig-subtext { font-size:7px; text-align:center; margin-top:2px; }
  .rc-footer { margin-top:8px; font-size:6px; color:#212529; text-align:center; border-top:1px solid #dee2e6; padding-top:3px; opacity:0.7; }
</style>
<div class="rc-header">
  {{#if brand.logoLight}}<img src="{{brand.logoLight}}" />{{else}}<span></span>{{/if}}
  <div class="rc-title">CIERRE DE RUTA</div>
  <div><div class="rc-date">{{generatedDate}}</div><div class="rc-date">{{generatedTime}}</div></div>
</div>
<div class="rc-grid">
  <div class="cell"><div class="rc-lbl">Sucursal</div><div class="rc-val">{{subsidiaryName}}</div></div>
  <div class="cell"><div class="rc-lbl">Vehículo</div><div class="rc-val">{{vehicleName}}</div></div>
  <div class="cell"><div class="rc-lbl">Chofer</div><div class="rc-val">{{mainDriver}}</div></div>
  <div class="cell"><div class="rc-lbl">Ruta(s)</div><div class="rc-val">{{routeNames}}</div></div>
  <div class="cell"><div class="rc-lbl">Fecha Despacho</div><div class="rc-val">{{dispatchDate}}</div></div>
  <div class="cell"><div class="rc-lbl">POD Entregados</div><div class="rc-val">{{stats.podDeliveredCount}}</div></div>
</div>
<div class="rc-main">
  <div class="rc-left">
    <div class="rc-section-title">DEVUELTOS ({{returnedRows.length}})</div>
    {{#if hasReturned}}
    <table class="rc-table">
      <thead><tr><th style="width:45%">GUÍA</th><th style="width:20%">TIPO</th><th style="width:35%">MOTIVO</th></tr></thead>
      <tbody>
        {{#each returnedRows}}
        <tr class="{{rowClass}}">
          <td>{{trackingNumber}}</td><td>{{shipmentTypeLabel}}</td><td>{{motivoPdf}}</td>
        </tr>
        {{/each}}
      </tbody>
    </table>
    {{else}}
    <div class="rc-empty">No hay devueltos</div>
    {{/if}}

    <div class="rc-section-title">PAQUETES NO VAN ({{noVanRows.length}})</div>
    {{#if hasNoVan}}
    <table class="rc-table">
      <thead><tr><th style="width:60%">GUÍA</th><th style="width:40%">ESTATUS</th></tr></thead>
      <tbody>
        {{#each noVanRows}}
        <tr><td>{{trackingNumber}}</td><td>{{status}}</td></tr>
        {{/each}}
      </tbody>
    </table>
    {{else}}
    <div class="rc-empty">No hay paquetes No VAN</div>
    {{/if}}

    <div class="rc-section-title">DEX - EXCEPCIONES</div>
    <div class="rc-dex-container">
      <div class="rc-dex-box"><div class="rc-dex-title">DEX 03</div><div class="rc-dex-value">{{stats.dex03CountPdf}}</div></div>
      <div class="rc-dex-box"><div class="rc-dex-title">DEX 07</div><div class="rc-dex-value">{{stats.dex07CountPdf}}</div></div>
      <div class="rc-dex-box"><div class="rc-dex-title">DEX 08</div><div class="rc-dex-value">{{stats.dex08CountPdf}}</div></div>
      <div class="rc-dex-box"><div class="rc-dex-title">DEX 12</div><div class="rc-dex-value">{{stats.dex12CountPdf}}</div></div>
    </div>
  </div>

  <div class="rc-right">
    <div class="rc-section-title">DESGLOSE POR PAQUETERÍA</div>
    <table class="rc-table">
      <thead><tr><th style="width:25%"></th><th style="width:25%">TOTAL</th><th style="width:25%">ENT</th><th style="width:25%">DEV</th></tr></thead>
      <tbody>
        <tr><td>FedEx</td><td>{{stats.fedexTotal}}</td><td>{{stats.fedexDelivered}}</td><td>{{stats.fedexReturned}}</td></tr>
        <tr class="even"><td>DHL</td><td>{{stats.dhlTotal}}</td><td>{{stats.dhlDelivered}}</td><td>{{stats.dhlReturned}}</td></tr>
      </tbody>
    </table>

    <div class="rc-section-title">RECOLECCIONES ({{collections.length}})</div>
    {{#if hasCollections}}
    <div class="rc-collections">
      <div class="rc-collections-grid">
        {{#each collections}}<div class="rc-collection-item">{{this}}</div>{{/each}}
      </div>
    </div>
    {{else}}
    <div class="rc-empty">No hay recolecciones</div>
    {{/if}}

    <div class="rc-section-title">COBROS ({{podCharges.length}})</div>
    {{#if hasPodCharges}}
    <table class="rc-table">
      <thead><tr><th style="width:50%">GUÍA</th><th style="width:25%">TIPO</th><th style="width:25%">MONTO</th></tr></thead>
      <tbody>
        {{#each podCharges}}
        <tr><td>{{trackingNumber}}</td><td>{{type}}</td><td>{{amountPdf}}</td></tr>
        {{/each}}
      </tbody>
    </table>
    {{else}}
    <div class="rc-empty">No hay cobros</div>
    {{/if}}

    <div class="rc-stats">
      <div class="rc-stat-box"><div class="rc-stat-title">SALIDA</div><div class="rc-stat-value">{{stats.originalCount}}</div></div>
      <div class="rc-stat-box"><div class="rc-stat-title">NO VAN</div><div class="rc-stat-value secondary">{{stats.noVanCount}}</div></div>
      <div class="rc-stat-box"><div class="rc-stat-title">ENTREGADOS</div><div class="rc-stat-value">{{stats.podDeliveredCount}}</div></div>
      <div class="rc-stat-box"><div class="rc-stat-title">% DEVOLUCIÓN</div><div class="rc-stat-value {{#if stats.returnRateHigh}}high{{else}}ok{{/if}}">{{stats.returnRateFmt}}</div></div>
    </div>
  </div>
</div>
<div class="rc-signatures">
  <div class="rc-sig">
    <div class="rc-sig-line"></div>
    <div class="rc-sig-text">FIRMA DE CONFORMIDAD</div>
    <div class="rc-sig-subtext">{{mainDriver}} - Conductor</div>
  </div>
  <div class="rc-sig">
    <div class="rc-sig-line"></div>
    <div class="rc-sig-text">FIRMA DE CONFIRMACIÓN</div>
    <div class="rc-sig-subtext">{{subsidiaryName}}</div>
  </div>
</div>
<div class="rc-footer">Documento generado automáticamente - PMY App v.1.0 - {{generatedDate}} {{generatedTime}}</div>
`;

/** HTML-Handlebars fiel a C1 (frontend `FedExPackageDispatchPDF`, "Salida a Ruta"). */
export const ROUTE_DISPATCH_PDF_HTML = `
<style>
  body { font-size: 9px; color: #212529; }
  .rd-header { display:flex; justify-content:space-between; align-items:center; height:35px; margin-bottom:3px; padding-bottom:2px; border-bottom:1px solid #8c5e4e; }
  .rd-header img { width:30px; height:30px; }
  .rd-title { font-size:14px; font-weight:bold; color:#8c5e4e; text-align:center; }
  .rd-date { font-size:8px; color:#212529; text-align:right; line-height:1.1; }
  .rd-grid, .rd-metrics { display:flex; justify-content:space-between; height:25px; padding:2px; margin-bottom:2px; background:#f8f9fa; border-radius:2px; border:0.5px solid #000; }
  .rd-grid .cell { width:32%; padding:0.5px; }
  .rd-metrics .cell { flex:1; text-align:center; }
  .rd-lbl { font-size:7px; font-weight:bold; color:#8c5e4e; }
  .rd-val { font-size:7px; color:#212529; line-height:1; }
  .rd-val.hi { color:#fd7e14; } .rd-val.urg { color:#ff6b6b; }
  .rd-sym { display:flex; justify-content:center; height:10px; padding:1px; margin-bottom:2px; background:#f8f9fa; border-radius:2px; border:0.5px solid #000; font-size:6px; font-weight:bold; color:#8c5e4e; }
  table { width:100%; border-collapse:collapse; border:0.5px solid #000; border-radius:3px; }
  thead th { background:#8c5e4e; color:#fff; padding:1px; font-size:8px; font-weight:bold; text-align:left; }
  tbody td { padding:0.5px; border-bottom:0.5px solid #000; font-size:9px; }
  tr.even td { background:#f8f9fa; }
  tr.pago td { background:#fff2cc; font-weight:bold; }
  tr.vencehoy td { background:#ffe6e6; }
  tr.zone td { border-top:2px solid #8c5e4e; }
  .rd-invalid { margin-top:6px; border:0.5px solid #ff9999; }
  .rd-invalid .banner { background:#ff9999; color:#fff; text-align:center; font-size:10px; font-weight:bold; padding:2px; }
  .rd-invalid tr.even td { background:#fff0f0; }
  .rd-invalid td.idx { color:#cc0000; font-weight:bold; }
</style>
<div class="rd-header">
  {{#if brand.logoLight}}<img src="{{brand.logoLight}}" />{{else}}<span></span>{{/if}}
  <div class="rd-title">SALIDA A RUTA</div>
  <div class="rd-date">{{generatedDate}}<br/>{{generatedTime}}</div>
</div>
<div class="rd-grid">
  <div class="cell"><div class="rd-lbl">Sucursal</div><div class="rd-val">{{subsidiaryName}}</div></div>
  <div class="cell"><div class="rd-lbl">Vehículo</div><div class="rd-val">{{vehicleName}}</div></div>
  <div class="cell"><div class="rd-lbl">Chofer Principal</div><div class="rd-val">{{mainDriver}}</div></div>
</div>
<div class="rd-metrics">
  <div class="cell"><div class="rd-lbl">RUTA</div><div class="rd-val">{{routeNames}}</div></div>
  <div class="cell"><div class="rd-lbl">SEGUIMIENTO</div><div class="rd-val">{{trackingNumber}}</div></div>
  <div class="cell"><div class="rd-lbl">TOTAL</div><div class="rd-val">{{stats.total}}</div></div>
  <div class="cell"><div class="rd-lbl">REGULARES</div><div class="rd-val">{{stats.regularCount}}</div></div>
  <div class="cell"><div class="rd-lbl">F2 / 31.5</div><div class="rd-val hi">{{stats.f2Count}}</div></div>
  <div class="cell"><div class="rd-lbl">ALTO VALOR</div><div class="rd-val hi">{{stats.cargaCount}}</div></div>
  <div class="cell"><div class="rd-lbl">CON COBRO</div><div class="rd-val">{{stats.withPaymentCount}}</div></div>
  <div class="cell"><div class="rd-lbl">VENCEN HOY</div><div class="rd-val urg">{{stats.expiringTodayCount}}</div></div>
  <div class="cell"><div class="rd-lbl">MONTO</div><div class="rd-val">{{stats.montoFmt}}</div></div>
  <div class="cell"><div class="rd-lbl">Fedex</div><div class="rd-val">{{stats.fedexCount}}</div></div>
  <div class="cell"><div class="rd-lbl">DHL</div><div class="rd-val">{{stats.dhlCount}}</div></div>
</div>
<div class="rd-sym">SIMBOLOGÍA: [C] CARGA/F2/31.5 • [$] PAGO • [H] VALOR ALTO • [A] AÉREO (PRIORIDAD)</div>
<table>
  <thead><tr>
    <th style="width:30px">[#]</th><th style="width:65px">NO. GUIA</th><th style="width:135px">NOMBRE</th>
    <th style="width:155px">DIRECCIÓN</th><th style="width:26px">CP</th><th style="width:63px">COBRO</th>
    <th style="width:47px">FECHA</th>{{#unless isHermosillo}}<th style="width:38px">HORA</th>{{/unless}}
    <th style="width:50px">CELULAR</th><th style="width:80px">NOMBRE Y FIRMA</th>
  </tr></thead>
  <tbody>
    {{#each rows}}
    <tr class="{{rowClass}}">
      <td>{{icons}} {{index}}</td><td>{{trackingNumber}}</td><td>{{recipientName}}</td>
      <td>{{recipientAddress}}</td><td>{{recipientZip}}</td><td>{{paymentPdf}}</td>
      <td>{{date}}</td>{{#unless ../isHermosillo}}<td>{{time}}</td>{{/unless}}
      <td>{{recipientPhone}}</td><td></td>
    </tr>
    {{/each}}
  </tbody>
</table>
{{#if hasInvalid}}
<div class="rd-invalid">
  <div class="banner">TRACKINGS INVÁLIDOS / NO ENCONTRADOS</div>
  <table>
    <thead><tr>
      <th style="width:30px">[#]</th><th style="width:65px">NO. GUIA</th><th style="width:135px">NOMBRE</th>
      <th style="width:155px">DIRECCIÓN</th><th style="width:26px">CP</th><th style="width:63px">COBRO</th>
      <th style="width:47px">FECHA</th>{{#unless isHermosillo}}<th style="width:38px">HORA</th>{{/unless}}
      <th style="width:50px">CELULAR</th><th style="width:60px">NOMBRE Y FIRMA</th>
    </tr></thead>
    <tbody>
      {{#each invalidRows}}
      <tr class="{{#if @even}}even{{/if}}">
        <td class="idx">{{index}}</td><td class="idx">{{trackingNumber}}</td><td></td><td></td><td></td><td></td><td></td>
        {{#unless ../isHermosillo}}<td></td>{{/unless}}<td></td><td></td>
      </tr>
      {{/each}}
    </tbody>
  </table>
</div>
{{/if}}
`;

/** HTML-Handlebars fiel a C9 (frontend `EnhancedFedExPDF`, "Devoluciones y Recolecciones"). A4 portrait, 2 columnas (flex). */
export const RETURNING_PDF_HTML = `
<style>
  body { font-size: 9px; color: #212529; }
  .rt-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; background:#f8f9fa; padding:8px; border-radius:4px; }
  .rt-brand { display:flex; align-items:center; }
  .rt-brand .fed { color:#662d91; font-size:16px; font-weight:bold; }
  .rt-brand .ex { color:#ff6600; font-size:16px; font-weight:bold; }
  .rt-date-label { font-size:9px; font-weight:bold; margin-bottom:2px; text-align:right; }
  .rt-date-value { font-size:10px; border:1px solid #000; padding:4px; width:70px; text-align:center; }
  .rt-location { margin-bottom:12px; }
  .rt-locality { font-size:10px; font-weight:bold; margin-bottom:3px; }
  .rt-subsidiary { font-size:13px; font-weight:bold; margin-bottom:3px; }
  .rt-subtitle { font-size:13px; color:#646464; }
  .rt-summary { display:flex; justify-content:space-between; gap:8px; margin-bottom:16px; }
  .rt-summary-box { flex:1; border:1px solid #c8c8c8; border-radius:4px; padding:6px; }
  .rt-summary-header { font-size:8px; font-weight:bold; color:#464646; text-align:center; margin-bottom:3px; }
  .rt-summary-value { font-size:13px; font-weight:bold; text-align:center; background:#fff; padding:5px; border:1px solid #eee; border-radius:3px; }
  .rt-columns { display:flex; justify-content:space-between; }
  .rt-col { width:48%; }
  .rt-section-header { color:#fff; padding:4px; font-size:9px; font-weight:bold; margin-bottom:4px; }
  .rt-section-purple { background:#662d91; }
  .rt-section-orange { background:#ff6600; }
  table.rt-table { width:100%; border-collapse:collapse; }
  table.rt-table thead th { background:#f0f0f0; padding:3px; font-size:8px; font-weight:bold; text-align:left; }
  table.rt-table tbody td { padding:3px; border-bottom:1px solid #dcdcdc; font-size:7.5px; }
  table.rt-table tbody tr.even td { background:#fcfcfc; }
  .rt-dex { color:#b40000; font-weight:bold; }
  .rt-signature { margin-top:24px; text-align:center; }
  .rt-signature-line { border-top:1px solid #000; width:60%; margin:0 auto 4px; padding-top:4px; }
  .rt-signature-text { font-size:8px; text-align:center; color:#505050; }
  .rt-footer { background:#f8f9fa; padding:8px; margin-top:16px; font-size:7px; color:#505050; }
</style>
<div class="rt-header">
  <div class="rt-brand"><span class="fed">Fed</span><span class="ex">Ex</span><span style="font-size:6px;margin-left:2px;">&reg;</span></div>
  <div>
    <div class="rt-date-label">FECHA</div>
    <div class="rt-date-value">{{generatedDate}}</div>
  </div>
</div>
<div class="rt-location">
  <div class="rt-locality">LOCALIDAD:</div>
  <div class="rt-subsidiary">{{subsidiaryNameUpper}}</div>
  <div class="rt-subtitle">DEVOLUCIONES Y RECOLECCIONES</div>
</div>
<div class="rt-summary">
  <div class="rt-summary-box"><div class="rt-summary-header">TOTAL RECOLECCIONES</div><div class="rt-summary-value">{{totalRecolecciones}}</div></div>
  <div class="rt-summary-box"><div class="rt-summary-header">TOTAL DEVOLUCIONES</div><div class="rt-summary-value">{{totalDevoluciones}}</div></div>
  <div class="rt-summary-box"><div class="rt-summary-header">TOTAL GENERAL</div><div class="rt-summary-value">{{totalGeneral}}</div></div>
</div>
<div class="rt-columns">
  <div class="rt-col">
    <div class="rt-section-header rt-section-purple">DEVOLUCION (Envío no entregado)</div>
    <table class="rt-table">
      <thead><tr><th style="width:15%">No.</th><th style="width:40%">NO. GUIA</th><th style="width:45%">MOTIVO</th></tr></thead>
      <tbody>
        {{#each devolucionRowsPdf}}
        <tr class="{{rowClass}}">
          <td style="width:15%">{{index}}</td>
          <td style="width:40%">{{trackingNumber}}</td>
          <td style="width:45%"><span class="{{#if isDex}}rt-dex{{/if}}">{{motivo}}</span></td>
        </tr>
        {{/each}}
      </tbody>
    </table>
  </div>
  <div class="rt-col">
    <div class="rt-section-header rt-section-orange">RECOLECCIONES</div>
    <table class="rt-table">
      <thead><tr><th style="width:60%">NO. GUIA</th><th style="width:20%">SUC.</th><th style="width:20%">No.</th></tr></thead>
      <tbody>
        {{#each recoleccionRowsPdf}}
        <tr class="{{rowClass}}">
          <td style="width:60%">{{trackingNumber}}</td>
          <td style="width:20%">{{sucursal}}</td>
          <td style="width:20%">{{index}}</td>
        </tr>
        {{/each}}
      </tbody>
    </table>
  </div>
</div>
<div class="rt-signature">
  <div class="rt-signature-line"></div>
  <div class="rt-signature-text">Nombre y Firma</div>
</div>
<div class="rt-footer">
  <div>DEX 03: DATOS INCORRECTOS / DOM NO EXISTE</div>
  <div>DEX 07: RECHAZO DE PAQUETES POR EL CLIENTE</div>
  <div>DEX 08: VISITA / DOMICILIO CERRADO</div>
  <div>DEX 17: CAMBIO DE FECHA SOLICITADO</div>
</div>
`;

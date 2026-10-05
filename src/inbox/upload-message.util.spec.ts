import { buildUploadMessage } from './upload-message.util';

const email = { subject: 'CARGA YAQUI CABO 10/01/26', from: 'Jose Gaxiola', receivedAt: new Date('2026-10-02T02:32:00Z') };

describe('upload-message.util', () => {
  it('master con nuevos, reingresos, alto valor y cobros', () => {
    const t = buildUploadMessage({
      userName: 'Javier Laris',
      filename: 'CARGA_305821242296_YAQUI_SJDA.xlsx',
      sheet: 'CARGA',
      subsidiaryName: 'Cabo San Lucas',
      kind: 'master',
      consNumber: '305821242296',
      consDate: '2026-10-01',
      fileRows: 189,
      summary: { saved: 185, recycled: 4, hvMarked: 1, cobrosApplied: 11 },
      email,
      uploadedAt: new Date('2026-10-02T03:17:00Z'),
    });
    expect(t).toContain('*Javier Laris* subió *CARGA_305821242296_YAQUI_SJDA.xlsx* (hoja "CARGA")');
    expect(t).toContain('Sucursal: *Cabo San Lucas*');
    expect(t).toContain('Carga master · consolidado *305821242296* · fecha 01/10/2026');
    expect(t).toContain('Paquetes: 189 en el archivo · 185 nuevos · 4 reingresos');
    expect(t).toContain('Alto valor: 1');
    expect(t).toContain('Cobros: 11 aplicados');
    expect(t).toContain('subido a los 45 min');
  });

  it('F2: habla de cargas, sin alto valor; cobros sin guía avisados', () => {
    const t = buildUploadMessage({
      userName: 'Ana',
      filename: 'F2.xlsx',
      subsidiaryName: 'Vía Larga',
      kind: 'f2',
      consNumber: '305821512729',
      fileRows: 15,
      summary: { saved: 15, cobrosApplied: 2, cobrosUnmatched: 1 },
      email,
      uploadedAt: new Date('2026-10-02T05:00:00Z'),
    });
    expect(t).toContain('F2 / carga');
    expect(t).toContain('Cargas: 15 en el archivo · 15 cargas F2 nuevas');
    expect(t).not.toContain('Alto valor');
    expect(t).toContain('Cobros: 2 aplicados · ⚠️ 1 sin guía');
    expect(t).toContain('subido a los 2 h 28 min');
  });
});

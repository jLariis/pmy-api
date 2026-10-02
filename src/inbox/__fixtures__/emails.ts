/**
 * Correos reales (recortados) recibidos en sistemas@ — casos fijos del detector.
 * Fuente: ejemplos compartidos por operación el 2026-10-01.
 */

const IMPORTANTE = `**IMPORTANTE**
Regresar el mismo archivo mañana antes de las 18h con la actualización del estatus de las guías DIARIAMENTE hasta que todos los envíos sean entregados o retornados a estación.

En caso de incumplimiento del envío puntual de este reporte, se aplicarán las medidas contractuales vigentes, con la penalización correspondiente a todas las facturas de la semana comprendidas en la fecha del reporte no enviado a tiempo.`;

export interface FixtureEmail {
  subject: string;
  from: string;
  cc: string[];
  attachments: string[];
  body: string;
}

export const CABO: FixtureEmail = {
  subject: 'CARGA YAQUI CABO 10/01/26',
  from: 'jose.gaxiola@fedex.com',
  cc: ['iliana.ortiz@fedex.com', 'loscabosteam@fedex.com', 'facturacionbcs@fedex.com'],
  attachments: ['CARGA_305821242296_YAQUI_SJDA.xlsx', 'CCP_305821242296_YAQUI_SJDA.xlsx'],
  body: `Buenas noches,


Se anexan archivos de carga

SALIDA CARGA YAQUI

MASTER 305821242296, 189 GUIAS.

F2 305821512729 , 15GUIAS.

COBROS

Tracking Number
Last COMM Scan Date
Last COMM Scan Update
383905050153
09/28/2026
COD-COLLECT CASH 2210.0 MXP
383905068486
09/28/2026
COD-COLLECT CASH 2560.0 MXP
383905207928
09/28/2026
COD-COLLECT CASH 2560.0 MXP
383905236431
09/28/2026
COD-COLLECT CASH 2150.0 MXP
383905266695
09/28/2026
COD-COLLECT CASH 2150.0 MXP
383905338448
09/28/2026
COD-COLLECT CASH 1530.0 MXP
383905365350
09/28/2026
COD-COLLECT CASH 2790.0 MXP
383905408437
09/28/2026
COD-COLLECT CASH 2210.0 MXP
383910257601
09/29/2026
COD-COLLECT CASH 2699.0 MXP
383911390941
09/28/2026
COD-COLLECT CASH 1900.0 MXP
383922060157
09/28/2026
COD-COLLECT CASH 1490.0 MXP

${IMPORTANTE}



JOSE GAXIOLA | OPS AGENT II | FEDEX  | The Americas Team |
Calle Primera SN, Parque industrial C.P. 23089  La Paz | Baja California Sur. Mexico | CP 23084 | fedex.com`,
};

export const SUR: FixtureEmail = {
  subject: 'CARGA YAQUI SUR 093026',
  from: 'luis.torres@fedex.com',
  cc: ['iliana.ortiz@fedex.com', 'cases-bcs@fedex.com', 'facturacionbcs@fedex.com'],
  attachments: ['CCP_305821198046_30SEP_YAQUISUR.xlsx', 'F2.xlsx', 'YAQUI.xlsx'],
  body: `Se anexan archivos de carga

SALIDA CARGA YAQUI


CARGA YAQUI 305821198046, 87 GUIAS.


COBROS
Tracking Number
Last COMM Scan Update
383584810210
COD-COLLECT CASH 2890.0 MXP
383657580766
COD-COLLECT CASH 2850.0 MXP
383770728881
COD-COLLECT CASH 2850.0 MXP
383819037182
COD-COLLECT CASH 940.0 MXP
877713622069
FTC-COLLECT CASH 579.64 MXP

${IMPORTANTE}








Luis Leonardo Torres Perez | Ops Agent II | FedEx Express | The Americas Team | mobile 6122047198
Calle primera, Lote 4 Mz 2, Paruqe industrial | La Paz | Baja California Sur. Mexico | CP 23084 | fedex.com`,
};

export const AEREO: FixtureEmail = {
  subject: 'Salida Aerea.',
  from: 'wendy.miranda@fedex.com',
  cc: ['loscabosteam@fedex.com'],
  attachments: ['ccp valor 01 oct.xlsx', 'ccp aereo 01 oct.xlsx', 'salida valor 10 oct.ods', 'salida aereo 01 oct.xlsx'],
  body: IMPORTANTE,
};

export const CABORCA: FixtureEmail = {
  subject: 'PREALERTA CABORCA PAQUETERIA DEL YAQUI',
  from: 'miguel.antonio@fedex.com',
  cc: ['marcoantonio.banuelos@fedex.com', 'sa_hmoa-noga@corp.ds.fedex.com'],
  attachments: ['PREALERTA CABORCA PQT YAQUI 01 OCT.xls', 'PREALERTA CABORCA PQT YAQUI 01 OCT.pdf'],
  body: `RUTA: CABORCA-PENASCO-SANTA ANA-BENJAMIN H.

 CHOFER: GERARDO ROBLES

 UNIDAD: TONELADA

 PLACAS: *****

  PAQUETES:123

CONS:818861721255



GUIAS CON COBRO

Tracking Number

Last COMM Scan Date

Last COMM Scan Update

383885282560

09/25/2026

COD-COLLECT CASH 3250.0 MXP

383905025439

09/28/2026

COD-COLLECT CASH 2450.0 MXP

383913948855

09/28/2026

COD-COLLECT CASH 1498.0 MXP





FedEx, Vivimos para entregar.

Saludos Cordiales / Best Regards



Miguel Antonio Rivas G.

OperationS Agent II HMOA
FedEx Express
+52(662) 2620119 Ext 2501
Fedex.com/mx



From: Miguel Antonio Rivas
Sent: Wednesday, September 30, 2026 2:06 PM
To: oficinahmo@paqueteriaymensajeriadelyaqui.com; sistemas@paqueteriaymensajeriadelyaqui.com
Cc: Marco Antonio Banuelos <marcoantonio.banuelos@fedex.com>; STAFF HMOA <sa_hmoa-noga@corp.ds.fedex.com>
Subject: PREALERTA CABORCA PAQUETERIA DEL YAQUI



RUTA: CABORCA-PENASCO-SANTA ANA-BENJAMIN H.

  PAQUETES:123

CONS:818861721656



GUIAS CON COBRO

NO PRECENTAN COBRO

From: Miguel Antonio Rivas
Sent: Monday, September 28, 2026 4:39 PM
Subject: PREALERTA CABORCA PAQUETERIA DEL YAQUI

  PAQUETES:313

CONS:818861721921

383818774205

09/22/2026

COD-COLLECT CASH 3250.0 MXP`,
};

export const SIN_COBRO_TOP = `RUTA: CABORCA-PENASCO-SANTA ANA-BENJAMIN H.

  PAQUETES:123

CONS:818861721656

GUIAS CON COBRO

NO PRECENTAN COBRO`;

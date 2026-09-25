/**
 * Semilla Compras v4: servicios base (sin receta, se completan en Mantenimiento → Servicios) y sinónimos
 * iniciales de piezas/insumos del catálogo "LARIS CATALAGO.xlsx". Todo es editable desde pantalla.
 */
export const SEED_SERVICES: Array<{ name: string; keywords: string }> = [
  { name: 'Servicio preventivo', keywords: 'servicio, preventivo, mantenimiento, cambio de aceite' },
  { name: 'Reparación general', keywords: 'reparacion, falla, descompuesta, no enciende, no arranca' },
  { name: 'Revisión de frenos', keywords: 'frenos, frenar, rechina, truena al frenar, no frena' },
  { name: 'Afinación', keywords: 'afinacion, jalonea, tironea, se apaga' },
];

/** Nombre de la categoría (tal como está en el catálogo) → sinónimos. */
export const SEED_CATEGORY_KEYWORDS: Record<string, string> = {
  'BALATA DELANTERA': 'frenos, rechina, balatas',
  'BALATA TRASERA': 'balatas traseras, rechina atras',
  'DISCO DE FRENO': 'vibra al frenar, disco',
  'TAMBOR DE FRENOS': 'tambor',
  'LIQUIDO DE FRENOS': 'pedal suave, pedal se hunde',
  'ACEITE': 'aceite, cambio de aceite, lubricante, servicio',
  'FILTRO ACEITE SINTÉTICO': 'filtro de aceite, cambio de aceite',
  'FILTRO ACEITE MINERAL': 'filtro de aceite, cambio de aceite',
  'FILTRO AIRE MOTOR': 'filtro de aire',
  'FILTRO GASOLINA': 'filtro de gasolina',
  'FILTRO DIESEL': 'filtro de diesel',
  'LLANTA RADIAL': 'llanta, llantas, ponchada, neumatico',
  'LLANTA CARGA': 'llanta, llantas, ponchada, neumatico',
  'AMORTIGUADOR DELANTERO': 'suspension, amortiguador, rebota',
  'AMORTIGUADOR TRASERO': 'suspension, amortiguador, rebota',
  'BUJIA COBRE': 'bujia, bujias, afinacion',
  'BUJIA PLATINO': 'bujia, bujias, afinacion',
  'BUJIA IRIDIO': 'bujia, bujias, afinacion',
  'LIQUIDO AFINACION': 'afinacion',
  'REFRIGERANTE VERDE': 'refrigerante, anticongelante, se calienta',
  'RADIADOR': 'radiador, se calienta, tira agua',
  'CLUTCH MECANICO': 'clutch, embrague, patina',
  'CLUTCH HIDRÁULICO': 'clutch, embrague, patina',
  'BOMBILLO STOP': 'stop, foco, luz de freno',
  'LIMPIA PARABRISAS': 'limpiaparabrisas, plumas',
};

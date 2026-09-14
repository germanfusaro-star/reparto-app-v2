// Tabla de condiciones de venta de Sigma2k (informativa).
// IMPORTANTE: esto es solo referencia para el chofer / para las alertas de cierre.
// La condición real de cobro (cobrado / cta cte) la determina el chofer en el momento,
// no este código.
const CONDICIONES_VENTA = {
  '00': { descripcion: 'Contado', esperaCobroInmediato: true },
  '01': { descripcion: 'Cta Cte 5 días', esperaCobroInmediato: false },
  '02': { descripcion: 'Cta Cte 12 días', esperaCobroInmediato: false },
  '03': { descripcion: 'Cta Cte Cheque', esperaCobroInmediato: false },
  '04': { descripcion: 'Cta Cte Cheque 14 días', esperaCobroInmediato: false },
  '05': { descripcion: 'Ctdo Cheque 10 días', esperaCobroInmediato: true },
  '06': { descripcion: 'Ctdo Cheque 7 días', esperaCobroInmediato: true },
  '07': { descripcion: 'Cta Cte Term 5 días', esperaCobroInmediato: false },
  '08': { descripcion: 'Cta Cte Term 12 días', esperaCobroInmediato: false },
  '09': { descripcion: 'Cta Cte Cheque 30 días', esperaCobroInmediato: false },
  '10': { descripcion: 'Cta Cte 3 días', esperaCobroInmediato: false },
};

function describirCondicion(codigo) {
  const c = CONDICIONES_VENTA[codigo];
  return c ? c.descripcion : `Código ${codigo ?? 's/d'}`;
}

function esperaCobroInmediato(codigo) {
  const c = CONDICIONES_VENTA[codigo];
  return c ? c.esperaCobroInmediato : false;
}

module.exports = { CONDICIONES_VENTA, describirCondicion, esperaCobroInmediato };

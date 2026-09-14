// Tabla de condiciones de venta de Sigma2k (informativa) — versión ESM para el front-end.
// MANTENER EN SINCRO con /lib/condiciones.js (la versión CommonJS que usa api/guia.js).
// IMPORTANTE: esto es solo referencia para el chofer / para las alertas de cierre.
// La condición real de cobro (cobrado / cta cte) la determina el chofer en el momento,
// no este código.
export const CONDICIONES_VENTA = {
  "00": { descripcion: "Contado", esperaCobroInmediato: true },
  "01": { descripcion: "Cta Cte 5 días", esperaCobroInmediato: false },
  "02": { descripcion: "Cta Cte 12 días", esperaCobroInmediato: false },
  "03": { descripcion: "Cta Cte Cheque", esperaCobroInmediato: false },
  "04": { descripcion: "Cta Cte Cheque 14 días", esperaCobroInmediato: false },
  "05": { descripcion: "Ctdo Cheque 10 días", esperaCobroInmediato: true },
  "06": { descripcion: "Ctdo Cheque 7 días", esperaCobroInmediato: true },
  "07": { descripcion: "Cta Cte Term 5 días", esperaCobroInmediato: false },
  "08": { descripcion: "Cta Cte Term 12 días", esperaCobroInmediato: false },
  "09": { descripcion: "Cta Cte Cheque 30 días", esperaCobroInmediato: false },
  "10": { descripcion: "Cta Cte 3 días", esperaCobroInmediato: false },
};

export function describirCondicion(codigo) {
  const c = CONDICIONES_VENTA[codigo];
  return c ? c.descripcion : `Código ${codigo ?? "s/d"}`;
}

export function esperaCobroInmediato(codigo) {
  const c = CONDICIONES_VENTA[codigo];
  return c ? c.esperaCobroInmediato : false;
}

// Orden natural de las condiciones (el mismo orden de códigos que usa Sigma2k),
// usado para ordenar el detalle por cliente en el reporte: primero por condición
// predeterminada, después alfabéticamente por nombre de cliente.
export const ORDEN_CONDICIONES = Object.keys(CONDICIONES_VENTA);

export function compararPorCondicionYNombre(a, b) {
  const ia = ORDEN_CONDICIONES.indexOf(a.condicionPredeterminada);
  const ib = ORDEN_CONDICIONES.indexOf(b.condicionPredeterminada);
  const oa = ia === -1 ? ORDEN_CONDICIONES.length : ia;
  const ob = ib === -1 ? ORDEN_CONDICIONES.length : ib;
  if (oa !== ob) return oa - ob;
  return a.nombre.localeCompare(b.nombre, "es-AR");
}

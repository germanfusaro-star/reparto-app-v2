export function fmt(n) {
  return (n || 0).toLocaleString("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  });
}

export function fmtDecimal(n) {
  return (n || 0).toLocaleString("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 2,
  });
}

export function toNumber(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

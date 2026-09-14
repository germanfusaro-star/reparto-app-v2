// Motivos de devolución / no entrega — misma tabla que usa Sigma2k ("Tabla de motivos de
// nc" en el ERP), para que el motivo que carga el chofer coincida con el que después ve
// administración en el ERP. Si el ERP agrega o renombra un código, actualizar acá.
export const MOTIVOS_DEVOLUCION = {
  "1": "SIN DINERO",
  "2": "CERRADO",
  "3": "NO PIDIO",
  "4": "SIN STOCK",
  "5": "NO ACCESIBLE",
  "6": "FECHA VTO CORTA",
  "7": "ERROR DE PREPARADO",
  "8": "NO INFORMO MOTIVO",
  "9": "ERROR FACTURACION",
  "10": "DEVOL. ERROR VENTA",
  "11": "ROTURA",
  "15": "ERROR CARGA DEPOS",
};

// Mismo orden en el que aparecen en el ERP, para el desplegable del chofer.
export const MOTIVOS_DEVOLUCION_LIST = Object.keys(MOTIVOS_DEVOLUCION).map((codigo) => ({
  codigo,
  nombre: MOTIVOS_DEVOLUCION[codigo],
}));

export function describirMotivoDevolucion(codigo) {
  if (!codigo) return "";
  const nombre = MOTIVOS_DEVOLUCION[String(codigo)];
  return nombre ? `${codigo} - ${nombre}` : `Código ${codigo}`;
}

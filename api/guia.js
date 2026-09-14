// Vercel Serverless Function
// GET /api/guia?guia_id=4277
//
// Trae de BigQuery (sigma-star-2.sigmarepo.bq_ventas) todos los comprobantes
// de una guía de reparto, agrupados por cliente, listos para que la app del
// chofer arme el manifiesto inicial y lo guarde en Firestore.
//
// Requiere variables de entorno en Vercel:
//   GCP_PROJECT_ID           -> "sigma-star-2"
//   GCP_SERVICE_ACCOUNT_JSON -> contenido completo (JSON, como string) de la
//                                service account key con permiso de lectura
//                                en BigQuery sobre el dataset sigmarepo.
//
// La service account es aparte de cualquier acceso que uses vos manualmente:
// hay que crearla en Google Cloud Console (IAM y administración > Cuentas de
// servicio) con el rol "BigQuery Data Viewer" + "BigQuery Job User" sobre el
// proyecto sigma-star-2, generar una clave JSON, y pegar ESE JSON completo
// como valor de la variable de entorno GCP_SERVICE_ACCOUNT_JSON en Vercel.

const { BigQuery } = require('@google-cloud/bigquery');
const { describirCondicion, esperaCobroInmediato } = require('../lib/condiciones');

function getBigQueryClient() {
  const credentials = JSON.parse(process.env.GCP_SERVICE_ACCOUNT_JSON);
  return new BigQuery({
    projectId: process.env.GCP_PROJECT_ID || 'sigma-star-2',
    credentials,
  });
}

// V2: ya no agrupamos a nivel comprobante (SUM) — traemos cada línea de artículo tal
// cual está en bq_ventas, para que el chofer pueda marcar devoluciones por artículo y
// cantidad en vez de tipear un monto a mano. El total por comprobante y por cliente se
// sigue calculando en JS sumando las líneas, así que nada que dependa de esos totales
// se rompe.
const QUERY = `
  SELECT
    CLIENTE_ID AS cliente_id,
    CLIENTE_NOMBRE AS cliente_nombre,
    CLIENTE_DIRECCION AS cliente_direccion,
    CLIENTE_LOCALIDAD AS cliente_localidad,
    CLIENTE_ZONA AS cliente_zona,
    CLIENTE_LATITUD AS cliente_lat,
    CLIENTE_LONGITUD AS cliente_lon,
    REPARTO AS reparto_codigo,
    REPARTO_NOMBRE AS reparto_nombre,
    FECHA AS fecha,
    COMPROBANTE_NUMERO AS comprobante_numero,
    COMPROBANTE_TIPO AS comprobante_tipo,
    CONDICION_DE_VENTA AS condicion_venta,
    ITEM_DESCRIPCION AS item_descripcion,
    ITEM_CANTIDAD AS item_cantidad,
    ITEM_PRECIO_UNITARIO AS item_precio_unitario,
    -- ITEM_NETO es el subtotal SIN IVA — el monto real de la factura (lo que el chofer
    -- tiene que cobrar, y lo que hay que descontar si vuelve un artículo) es ITEM_FINAL
    -- (neto + IVA + impuestos internos). Detectado con Germán el 2026-09-14: usar
    -- ITEM_NETO hacía que el total y el descuento por artículo quedaran ~20% de menos en
    -- cualquier comprobante con IVA discriminado. El campo se sigue llamando item_neto
    -- por compatibilidad con el resto del código, pero ahora trae el monto con IVA incluido.
    ROUND(ITEM_FINAL, 2) AS item_neto
  FROM \`sigma-star-2.sigmarepo.bq_ventas\`
  WHERE GUIA_ID = @guiaId
    AND COMPROBANTE_TIPO NOT IN ('NC', 'ND')
  ORDER BY cliente_nombre, comprobante_numero, item_descripcion
`;

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Método no permitido' });
    return;
  }

  const guiaIdRaw = req.query.guia_id;
  const guiaId = parseInt(guiaIdRaw, 10);
  if (!guiaIdRaw || Number.isNaN(guiaId)) {
    res.status(400).json({ error: 'Falta o es inválido el parámetro guia_id' });
    return;
  }

  try {
    const bigquery = getBigQueryClient();
    const [rows] = await bigquery.query({
      query: QUERY,
      params: { guiaId },
    });

    if (rows.length === 0) {
      res.status(404).json({ error: `No se encontraron comprobantes para la guía ${guiaId}` });
      return;
    }

    // Agrupar filas (cliente + comprobante + artículo) en clientes con su lista de
    // comprobantes, cada uno con su lista de artículos. El monto de cada comprobante y el
    // total del cliente se calculan sumando las líneas de artículo (antes venían ya
    // sumados desde BigQuery con SUM(ITEM_NETO); ahora que traemos el detalle, se suma acá).
    const clientesPorId = new Map();
    for (const row of rows) {
      if (!clientesPorId.has(row.cliente_id)) {
        clientesPorId.set(row.cliente_id, {
          cliente_id: row.cliente_id,
          nombre: row.cliente_nombre,
          direccion: row.cliente_direccion,
          localidad: row.cliente_localidad,
          zona: row.cliente_zona,
          lat: row.cliente_lat,
          lon: row.cliente_lon,
          comprobantesPorNumero: new Map(),
          monto_total: 0,
        });
      }
      const cliente = clientesPorId.get(row.cliente_id);

      if (!cliente.comprobantesPorNumero.has(row.comprobante_numero)) {
        cliente.comprobantesPorNumero.set(row.comprobante_numero, {
          numero: row.comprobante_numero,
          tipo: row.comprobante_tipo,
          condicion_venta: row.condicion_venta,
          condicion_venta_desc: describirCondicion(row.condicion_venta),
          espera_cobro_inmediato: esperaCobroInmediato(row.condicion_venta),
          monto: 0,
          items: [],
        });
      }
      const comprobante = cliente.comprobantesPorNumero.get(row.comprobante_numero);
      const itemNeto = row.item_neto || 0;
      const itemCantidad = row.item_cantidad || 0;
      comprobante.items.push({
        descripcion: row.item_descripcion,
        cantidad: itemCantidad,
        precio_unitario: row.item_precio_unitario || 0,
        neto: itemNeto,
      });
      comprobante.monto = Math.round((comprobante.monto + itemNeto) * 100) / 100;
      cliente.monto_total = Math.round((cliente.monto_total + itemNeto) * 100) / 100;
    }

    const clientes = Array.from(clientesPorId.values()).map((c) => {
      const { comprobantesPorNumero, ...resto } = c;
      return { ...resto, comprobantes: Array.from(comprobantesPorNumero.values()) };
    });
    const totalGuia = Math.round(
      clientes.reduce((acc, c) => acc + c.monto_total, 0) * 100
    ) / 100;

    res.status(200).json({
      guia_id: guiaId,
      reparto_codigo: rows[0].reparto_codigo,
      reparto_nombre: rows[0].reparto_nombre,
      fecha: rows[0].fecha ? rows[0].fecha.value || rows[0].fecha : null,
      total_guia: totalGuia,
      clientes,
    });
  } catch (err) {
    console.error('Error consultando BigQuery:', err);
    res.status(500).json({ error: 'Error consultando BigQuery', detalle: err.message });
  }
};

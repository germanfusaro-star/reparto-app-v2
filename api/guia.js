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
    FECHA AS comprobante_fecha,
    COMPROBANTE_NUMERO AS comprobante_numero,
    COMPROBANTE_TIPO AS comprobante_tipo,
    CONDICION_DE_VENTA AS condicion_venta,
    TRIM(ITEM_ARTICULO) AS item_codigo,
    ITEM_DESCRIPCION AS item_descripcion,
    ITEM_CANTIDAD AS item_cantidad,
    ITEM_PRECIO_UNITARIO AS item_precio_unitario,
    -- ITEM_NETO es el subtotal SIN IVA — el monto real de la factura (lo que el chofer
    -- tiene que cobrar, y lo que hay que descontar si vuelve un artículo) es ITEM_FINAL
    -- (neto + IVA + impuestos internos). Detectado con Germán el 2026-09-14: usar
    -- ITEM_NETO hacía que el total y el descuento por artículo quedaran ~20% de menos en
    -- cualquier comprobante con IVA discriminado. El campo se sigue llamando item_neto
    -- por compatibilidad con el resto del código, pero ahora trae el monto con IVA incluido.
    ROUND(ITEM_FINAL, 2) AS item_neto,
    -- Esta sí es la mercadería sin IVA (sin los impuestos internos incluidos en ITEM_NETO
    -- tampoco importan acá) — se usa solo como clave para encontrar la percepción de IVA
    -- de este comprobante en bq_contable (ver PERCEPCION_QUERY más abajo), nunca se le
    -- muestra al chofer.
    ROUND(ITEM_NETO, 2) AS item_neto_sin_iva
  FROM \`sigma-star-2.sigmarepo.bq_ventas\`
  WHERE GUIA_ID = @guiaId
    AND COMPROBANTE_TIPO NOT IN ('NC', 'ND')
  ORDER BY cliente_nombre, comprobante_numero, item_descripcion
`;

// Detectado con Germán el 2026-09-15: a ciertos clientes (según su condición fiscal)
// Sigma2k les suma al total de la factura una "Percepción de IVA a terceros" — no es
// parte del IVA discriminado por artículo, es un concepto aparte que el sistema calcula
// a nivel de comprobante. Ese monto NO existe en bq_ventas (se revisaron las ~140
// columnas de la tabla, no está en ninguna) — vive en la tabla contable bq_contable,
// como un asiento aparte (cuenta 21418 "PERCEP IVA A TERCEROS") dentro del mismo
// movimiento contable (ID) de la factura, junto a la línea de mercadería (cuenta 41101
// "VENTA DE MERCADERIAS") y la de IVA (21421). OJO: el campo SUBCUENTA (=CLIENTE_ID)
// solo viene cargado en la línea "DEUDORES POR VENTAS" (11201) de cada movimiento — en
// las demás líneas (mercadería, IVA, percepción) SUBCUENTA viene en 0, así que hay que
// agrupar TODO el movimiento por ID primero (sin filtrar ni agrupar por SUBCUENTA) y
// recién ahí sacar el cliente con MAX(SUBCUENTA) — filtrar por cliente antes de agrupar
// descarta justo las líneas que se necesitan. El movimiento se liga a un comprobante de
// bq_ventas cruzando fecha + cliente + el monto de mercadería sin IVA (tiene que
// coincidir centavo a centavo entre las dos tablas — no hay un campo de
// comprobante_numero en bq_contable para unir directo). Confirmado con el comprobante
// 00178649 de la guía 4290: Neto $184.343,52 + IVA $36.295,08 + Percepción $5.185,01 =
// Total $225.823,61 (coincide con Sigma2k al centavo). Solo afecta a una parte de los
// comprobantes (~15% en los últimos 30 días) — el resto no tiene percepción y esta
// consulta simplemente no devuelve movimiento para esos clientes.
const PERCEPCION_QUERY = `
  SELECT
    fecha,
    cliente_id,
    venta_mercaderia,
    percepcion_iva
  FROM (
    SELECT
      FECHA AS fecha,
      MAX(SUBCUENTA) AS cliente_id,
      ROUND(SUM(IF(CUENTA_CONTABLE_NUMERO = 41101, HABER, 0)), 2) AS venta_mercaderia,
      ROUND(SUM(IF(CUENTA_CONTABLE_NUMERO = 21418, HABER, 0)), 2) AS percepcion_iva
    FROM \`sigma-star-2.sigmarepo.bq_contable\`
    WHERE COMPROBANTE_CODIGO = 'VENT'
      AND FECHA IN UNNEST(@fechas)
    GROUP BY ID, fecha
  )
  WHERE percepcion_iva > 0
    AND cliente_id IN UNNEST(@clienteIds)
`;

function fechaComoTexto(fecha) {
  if (!fecha) return null;
  return fecha.value || fecha;
}

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
          // Campos internos, solo para buscar la percepción de IVA en bq_contable más
          // abajo — no se mandan en la respuesta final (ver PERCEPCION_QUERY arriba).
          _fecha: fechaComoTexto(row.comprobante_fecha),
          _montoMercaderiaSinIva: 0,
        });
      }
      const comprobante = cliente.comprobantesPorNumero.get(row.comprobante_numero);
      const itemNeto = row.item_neto || 0;
      const itemCantidad = row.item_cantidad || 0;
      comprobante.items.push({
        codigo: row.item_codigo || "",
        descripcion: row.item_descripcion,
        cantidad: itemCantidad,
        precio_unitario: row.item_precio_unitario || 0,
        neto: itemNeto,
      });
      comprobante.monto = Math.round((comprobante.monto + itemNeto) * 100) / 100;
      comprobante._montoMercaderiaSinIva =
        Math.round((comprobante._montoMercaderiaSinIva + (row.item_neto_sin_iva || 0)) * 100) / 100;
      cliente.monto_total = Math.round((cliente.monto_total + itemNeto) * 100) / 100;
    }

    // Buscar la percepción de IVA a terceros de cada comprobante (cuando corresponde,
    // ver PERCEPCION_QUERY más arriba) y sumarla al monto del comprobante y del cliente —
    // si no se hace esto, el total le queda por debajo del de la factura real en Sigma2k
    // para los clientes que tienen percepción.
    const fechasSet = new Set();
    const clienteIdsSet = new Set();
    for (const cliente of clientesPorId.values()) {
      for (const comp of cliente.comprobantesPorNumero.values()) {
        if (comp._fecha) fechasSet.add(comp._fecha);
        clienteIdsSet.add(cliente.cliente_id);
      }
    }
    // Detectado con la guía 4295 (2026-09-16): el monto de mercadería sin IVA a veces
    // difiere en 1 o 2 centavos entre bq_ventas (suma de ITEM_NETO redondeado por línea) y
    // bq_contable (HABER de la cuenta 41101, redondeado del lado contable) — son dos
    // cálculos distintos del lado de Sigma2k, no un error nuestro, pero un cruce por
    // igualdad exacta de string perdía la percepción entera de esos comprobantes. Ahora se
    // agrupa por fecha+cliente (sin el monto en la clave) y se busca, entre los movimientos
    // de ese cliente en esa fecha, el que tenga el monto de mercadería MÁS CERCANO al del
    // comprobante, aceptando hasta 2 centavos de diferencia — y una vez usado un movimiento
    // no se lo vuelve a usar para otro comprobante del mismo cliente/día.
    const TOLERANCIA_CENTAVOS = 0.02;
    const percepcionPorClienteFecha = new Map();
    let filasPercepcion = [];
    if (fechasSet.size > 0 && clienteIdsSet.size > 0) {
      [filasPercepcion] = await bigquery.query({
        query: PERCEPCION_QUERY,
        params: { fechas: Array.from(fechasSet), clienteIds: Array.from(clienteIdsSet) },
        types: { fechas: ['DATE'], clienteIds: ['INT64'] },
      });
      filasPercepcion.forEach((f) => {
        const clave = `${fechaComoTexto(f.fecha)}|${f.cliente_id}`;
        if (!percepcionPorClienteFecha.has(clave)) percepcionPorClienteFecha.set(clave, []);
        percepcionPorClienteFecha.get(clave).push({
          ventaMercaderia: f.venta_mercaderia,
          percepcionIva: f.percepcion_iva,
          usada: false,
        });
      });
    }

    for (const cliente of clientesPorId.values()) {
      for (const comp of cliente.comprobantesPorNumero.values()) {
        const clave = `${comp._fecha}|${cliente.cliente_id}`;
        const candidatos = percepcionPorClienteFecha.get(clave);
        if (candidatos) {
          let mejor = null;
          let mejorDif = null;
          for (const candidato of candidatos) {
            if (candidato.usada) continue;
            const dif = Math.abs(candidato.ventaMercaderia - comp._montoMercaderiaSinIva);
            if (dif <= TOLERANCIA_CENTAVOS && (mejorDif === null || dif < mejorDif)) {
              mejor = candidato;
              mejorDif = dif;
            }
          }
          if (mejor) {
            mejor.usada = true;
            comp.percepcion_iva = mejor.percepcionIva;
            comp.monto = Math.round((comp.monto + mejor.percepcionIva) * 100) / 100;
            cliente.monto_total = Math.round((cliente.monto_total + mejor.percepcionIva) * 100) / 100;
          }
        }
        delete comp._fecha;
        delete comp._montoMercaderiaSinIva;
      }
    }

    const clientes = Array.from(clientesPorId.values()).map((c) => {
      const { comprobantesPorNumero, ...resto } = c;
      return { ...resto, comprobantes: Array.from(comprobantesPorNumero.values()) };
    });
    const totalGuia = Math.round(
      clientes.reduce((acc, c) => acc + c.monto_total, 0) * 100
    ) / 100;

    // DEBUG TEMPORAL (2026-09-16) — para diagnosticar por qué la percepción de IVA no se
    // está sumando en producción aunque la lógica cierra bien en pruebas directas contra
    // BigQuery. Sacar este bloque una vez resuelto.
    const comprobantesConPercepcion = clientes.reduce(
      (acc, c) => acc + c.comprobantes.filter((comp) => comp.percepcion_iva).length,
      0
    );

    res.status(200).json({
      guia_id: guiaId,
      reparto_codigo: rows[0].reparto_codigo,
      reparto_nombre: rows[0].reparto_nombre,
      fecha: fechaComoTexto(rows[0].comprobante_fecha),
      total_guia: totalGuia,
      clientes,
      _debug: {
        fechasSet: Array.from(fechasSet),
        clienteIdsCount: clienteIdsSet.size,
        clienteIdsSample: Array.from(clienteIdsSet).slice(0, 5),
        filasPercepcionCount: filasPercepcion.length,
        filasPercepcionSample: filasPercepcion.slice(0, 3),
        comprobantesConPercepcion,
      },
    });
  } catch (err) {
    console.error('Error consultando BigQuery:', err);
    res.status(500).json({ error: 'Error consultando BigQuery', detalle: err.message, stack: err.stack });
  }
};

// Capa de acceso a datos de Firestore para una guía de reparto.
// Implementa el esquema y las fórmulas documentadas en DATA_MODEL.md — cualquier cambio
// a las fórmulas del cierre o a la lógica de alertas tiene que reflejarse en los dos lados.
//
// Pensada para usarse desde los componentes de React (Login, ListaClientes, DetalleCliente,
// Cierre) sin que esos componentes tengan que conocer la forma exacta de los documentos.

import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  collection,
  writeBatch,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase";
import { esperaCobroInmediato, compararPorCondicionYNombre } from "../lib/condiciones";

const guiaRef = (guiaId) => doc(db, "guias", String(guiaId));
const clientesCol = (guiaId) => collection(db, "guias", String(guiaId), "clientes");
const clienteRef = (guiaId, clienteId) => doc(db, "guias", String(guiaId), "clientes", String(clienteId));

function montoTotalComprobantes(comprobantes) {
  return Math.round(comprobantes.reduce((a, c) => a + c.monto, 0) * 100) / 100;
}

/**
 * Crea (o sobreescribe) la guía en Firestore a partir del manifiesto que devuelve
 * GET /api/guia?guia_id=... — este es el único paso que necesita señal: de acá en
 * adelante el chofer trabaja contra la copia local de Firestore.
 */
export async function crearGuiaDesdeManifiesto(manifiesto, choferNombre) {
  const guiaId = String(manifiesto.guia_id);
  const batch = writeBatch(db);

  batch.set(guiaRef(guiaId), {
    guiaId: manifiesto.guia_id,
    repartoCodigo: manifiesto.reparto_codigo,
    repartoNombre: manifiesto.reparto_nombre,
    fecha: manifiesto.fecha,
    choferNombre,
    estado: "abierta",
    fechaApertura: serverTimestamp(),
    fechaCierre: null,
    totalGuia: manifiesto.total_guia,
    totales: null,
    alertas: [],
    avisoFinReparto: false,
    avisoFinRepartoEn: null,
  });

  manifiesto.clientes.forEach((cliente) => {
    // V2: cada línea de artículo arranca con cantidadDevuelta: 0 — es lo que el chofer va
    // a tocar (en vez de tipear un monto) cuando la entrega es parcial o no entregada; el
    // monto devuelto se calcula sumando cantidadDevuelta * (item.neto / item.cantidad) de
    // las líneas marcadas (ver guardarEntregaCliente).
    const comprobantesConItems = (cliente.comprobantes || []).map((c) => ({
      ...c,
      items: (c.items || []).map((it) => ({ ...it, cantidadDevuelta: 0 })),
    }));
    batch.set(clienteRef(guiaId, cliente.cliente_id), {
      clienteId: cliente.cliente_id,
      nombre: cliente.nombre,
      direccion: cliente.direccion,
      localidad: cliente.localidad,
      zona: cliente.zona,
      lat: cliente.lat,
      lon: cliente.lon,
      comprobantes: comprobantesConItems,
      condicionPredeterminada: cliente.comprobantes[0]?.condicion_venta ?? null,
      montoTotal: cliente.monto_total,
      estado: "pendiente",
      montoDevuelto: 0,
      montoEntregado: 0,
      pagos: { efectivo: 0, cheque: 0, transferencia: 0 },
      chequesDetalle: [],
      montoCobrado: 0,
      montoCtaCte: 0,
      motivoDevolucion: "",
      transferenciasDetalle: [],
      visitadoEn: null,
    });
  });

  await batch.commit();
  return guiaId;
}

/**
 * El chofer avisa que terminó de repartir (todavía no implica que cerró/rindió la guía)
 * — queda marcado en la guía para que el panel de admin lo vea, sin depender de que el
 * chofer mande un mensaje aparte.
 */
export async function avisarFinReparto(guiaId) {
  await updateDoc(guiaRef(guiaId), {
    avisoFinReparto: true,
    avisoFinRepartoEn: serverTimestamp(),
  });
}

export async function obtenerGuia(guiaId) {
  const snap = await getDoc(guiaRef(guiaId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/** Clientes de la guía, ordenados por condición de venta predeterminada y luego por nombre. */
export async function listarClientes(guiaId) {
  const snap = await getDocs(clientesCol(guiaId));
  const clientes = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return clientes.sort(compararPorCondicionYNombre);
}

/**
 * Guarda la entrega + el cobro de un cliente.
 * `datos`: {
 *   estado: "completo" | "parcial" | "no_entregado",
 *   montoDevuelto: number,          // solo si estado === "parcial" — se arma en la
 *                                    // pantalla sumando lo marcado en `comprobantes`
 *                                    // (cantidadDevuelta por artículo), ver DATA_MODEL.md
 *   comprobantes: [...],            // copia de cliente.comprobantes con cantidadDevuelta
 *                                    // actualizada por artículo — queda guardada como
 *                                    // registro de qué se devolvió puntualmente (V2)
 *   motivoDevolucion: string,       // código de src/lib/motivosDevolucion.js (mismos
 *                                    // motivos que la tabla de nc de Sigma2k), opcional,
 *                                    // solo si estado !== "completo" — sigue siendo uno
 *                                    // solo por cliente, no por artículo
 *   efectivo: number,
 *   chequesDetalle: [{numero, banco, fecha, monto}],
 *   transferenciasDetalle: [{referencia, monto}],  // puede haber varias por cliente,
 *                                                    // igual que los cheques
 * }
 * El monto que se cobra siempre se calcula sobre el neto (monto_total − devuelto), nunca
 * sobre el total original — ver la regla de UI documentada en DATA_MODEL.md.
 */
export async function guardarEntregaCliente(guiaId, clienteId, cliente, datos) {
  const montoTotal = montoTotalComprobantes(cliente.comprobantes);
  const montoDevuelto =
    datos.estado === "parcial" ? Math.max(datos.montoDevuelto || 0, 0)
    : datos.estado === "no_entregado" ? montoTotal
    : 0;
  const montoEntregado = Math.max(montoTotal - montoDevuelto, 0);
  const comprobantes = datos.comprobantes || cliente.comprobantes;

  const efectivo = datos.estado === "no_entregado" ? 0 : Math.max(datos.efectivo || 0, 0);
  const chequesDetalle = datos.estado === "no_entregado" ? [] : (datos.chequesDetalle || []);
  const transferenciasDetalle = datos.estado === "no_entregado" ? [] : (datos.transferenciasDetalle || []);
  const cheque = Math.round(chequesDetalle.reduce((a, c) => a + (c.monto || 0), 0) * 100) / 100;
  const transferencia = Math.round(transferenciasDetalle.reduce((a, t) => a + (t.monto || 0), 0) * 100) / 100;

  const montoCobrado = Math.round((efectivo + cheque + transferencia) * 100) / 100;
  const montoCtaCte = Math.max(Math.round((montoEntregado - montoCobrado) * 100) / 100, 0);

  const motivoDevolucion = datos.estado === "completo" ? "" : (datos.motivoDevolucion || "").trim();

  const batch = writeBatch(db);
  batch.update(clienteRef(guiaId, clienteId), {
    estado: datos.estado,
    montoDevuelto,
    montoEntregado,
    comprobantes,
    pagos: { efectivo, cheque, transferencia },
    chequesDetalle,
    transferenciasDetalle,
    montoCobrado,
    montoCtaCte,
    motivoDevolucion,
    visitadoEn: serverTimestamp(),
  });
  // Si el chofer ya había avisado que terminó el reparto y ahora carga o corrige una
  // entrega, el aviso deja de ser válido hasta que lo confirme de nuevo — evita que quede
  // prendido "avisé que terminé" mientras todavía sigue tocando entregas.
  batch.update(guiaRef(guiaId), {
    avisoFinReparto: false,
    avisoFinRepartoEn: null,
  });
  await batch.commit();
}

/**
 * Calcula totales + alertas a partir de una lista de clientes (fórmulas documentadas en
 * DATA_MODEL.md). Es una función pura, no toca Firestore — la usan tanto cerrarGuia()
 * (que además persiste el resultado) como el panel de administración (que solo necesita
 * leer el estado de una guía, esté cerrada o no, sin modificarla).
 */
export function calcularTotalesYAlertas(clientes) {
  let totalGuia = 0,
    totalEntregado = 0,
    totalDevuelto = 0,
    totalCtaCte = 0,
    totalEfectivo = 0,
    totalCheque = 0,
    totalTransferencia = 0;
  const alertas = [];

  clientes.forEach((c) => {
    const montoTotal = montoTotalComprobantes(c.comprobantes);
    totalGuia += montoTotal;
    totalEntregado += c.montoEntregado || 0;
    totalDevuelto += c.montoDevuelto || 0;
    totalCtaCte += c.montoCtaCte || 0;
    totalEfectivo += c.pagos?.efectivo || 0;
    totalCheque += c.pagos?.cheque || 0;
    totalTransferencia += c.pagos?.transferencia || 0;

    if (c.estado === "pendiente") return; // no visitado: no genera alerta, sí queda fuera de los totales cobrados
    const esperaContado = esperaCobroInmediato(c.condicionPredeterminada);
    if (esperaContado && c.montoCtaCte > 0) {
      alertas.push({
        tipo: "warn",
        clienteId: c.clienteId,
        clienteNombre: c.nombre,
        motivo: "Quedó en cuenta corriente siendo contado",
        detalle: `$${c.montoCtaCte.toLocaleString("es-AR")} sin cobrar.`,
      });
    } else if (!esperaContado && c.montoCobrado > 0) {
      alertas.push({
        tipo: "info",
        clienteId: c.clienteId,
        clienteNombre: c.nombre,
        motivo: "Cuenta corriente cobrada por adelantado",
        detalle: `Se cobró $${c.montoCobrado.toLocaleString("es-AR")} sobre una condición en cuenta corriente.`,
      });
    }
  });

  const round2 = (n) => Math.round(n * 100) / 100;
  return {
    totalGuia: round2(totalGuia),
    totalEntregado: round2(totalEntregado),
    totalDevuelto: round2(totalDevuelto),
    totalCtaCte: round2(totalCtaCte),
    totalEfectivo: round2(totalEfectivo),
    totalCheque: round2(totalCheque),
    totalTransferencia: round2(totalTransferencia),
    // Neto a rendir = efectivo + cheque (lo que el chofer entrega físicamente en oficina;
    // las transferencias ya ingresaron directo a la cuenta bancaria) — confirmado con Germán.
    netoARendir: round2(totalEfectivo + totalCheque),
    alertas,
  };
}

/**
 * Cierra la guía: recalcula los totales y las alertas a partir de todos los clientes
 * y marca la guía como cerrada.
 * Devuelve { totales, alertas } para que la pantalla de cierre los muestre al toque,
 * sin tener que releer Firestore.
 */
export async function cerrarGuia(guiaId) {
  const clientes = await listarClientes(guiaId);
  const { alertas, ...totales } = calcularTotalesYAlertas(clientes);

  await updateDoc(guiaRef(guiaId), {
    estado: "cerrada",
    fechaCierre: serverTimestamp(),
    totales,
    alertas,
  });

  return { totales, alertas };
}

/** Todos los cheques cargados en la guía, para la sección "Detalle de cobranza por cheques". */
export async function listarChequesDeGuia(guiaId) {
  const clientes = await listarClientes(guiaId);
  const cheques = [];
  clientes.forEach((c) => {
    (c.chequesDetalle || []).forEach((ch) => {
      cheques.push({ clienteId: c.clienteId, clienteNombre: c.nombre, ...ch });
    });
  });
  return cheques;
}

/** Todas las transferencias cargadas en la guía, para la sección "Detalle de transferencias". */
export async function listarTransferenciasDeGuia(guiaId) {
  const clientes = await listarClientes(guiaId);
  const transferencias = [];
  clientes.forEach((c) => {
    (c.transferenciasDetalle || []).forEach((t) => {
      transferencias.push({ clienteId: c.clienteId, clienteNombre: c.nombre, ...t });
    });
  });
  return transferencias;
}

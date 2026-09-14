// Capa de datos para el panel de administración: lectura consolidada de varias guías a
// la vez (listado, KPIs, incidencias). No escribe nada — el panel es de solo lectura,
// el chofer sigue siendo el único que carga entregas/cobros desde la app.

import { collection, getDocs, query, orderBy, limit } from "firebase/firestore";
import { db } from "../firebase";
import { listarClientes, listarChequesDeGuia, listarTransferenciasDeGuia, calcularTotalesYAlertas } from "./guias";
import { describirMotivoDevolucion } from "../lib/motivosDevolucion";

const MAX_GUIAS = 300; // suficiente para meses de reparto diario; evita traer la colección entera

/** Últimas guías (abiertas y cerradas), más nuevas primero. */
export async function listarGuiasRecientes() {
  const q = query(collection(db, "guias"), orderBy("fechaApertura", "desc"), limit(MAX_GUIAS));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Resumen de una guía puntual (totales + alertas + cheques + clientes), calculado al
 * vuelo a partir de sus clientes — funciona esté la guía abierta o cerrada, sin tener
 * que esperar a que el chofer la cierre para poder verla desde el panel.
 */
export async function calcularResumenGuia(guiaId) {
  const clientes = await listarClientes(guiaId);
  const cheques = await listarChequesDeGuia(guiaId);
  const transferencias = await listarTransferenciasDeGuia(guiaId);
  const { alertas, ...totales } = calcularTotalesYAlertas(clientes);
  return { totales, alertas, cheques, transferencias, clientes };
}

function dentroDeRango(fecha, desde, hasta) {
  if (!fecha) return !desde && !hasta;
  if (desde && fecha < desde) return false;
  if (hasta && fecha > hasta) return false;
  return true;
}

/**
 * Resumen consolidado para el dashboard: KPIs generales + una guía por fila + todas las
 * incidencias (parciales, no entregados, alertas de cta. cte.) juntas para revisar de un
 * vistazo qué pedidos tuvieron problemas y por qué.
 *
 * `filtro`: { desde, hasta } en formato "YYYY-MM-DD" (igual que guia.fecha), o vacíos
 * para traer todo lo que haya en los últimos MAX_GUIAS registros.
 */
export async function calcularResumenGlobal(filtro = {}) {
  const { desde, hasta } = filtro;
  const todasLasGuias = await listarGuiasRecientes();
  const guiasEnRango = todasLasGuias.filter((g) => dentroDeRango(g.fecha, desde, hasta));

  const filas = [];
  const incidencias = [];
  let totalGuias = 0,
    totalRecaudado = 0,
    totalPendienteCtaCte = 0,
    totalTransferencias = 0,
    guiasAbiertas = 0,
    guiasCerradas = 0;

  for (const guia of guiasEnRango) {
    const resumen = await calcularResumenGuia(guia.guiaId ?? guia.id);
    totalGuias += resumen.totales.totalGuia;
    totalRecaudado += resumen.totales.netoARendir;
    totalPendienteCtaCte += resumen.totales.totalCtaCte;
    totalTransferencias += resumen.totales.totalTransferencia;
    if (guia.estado === "cerrada") guiasCerradas += 1;
    else guiasAbiertas += 1;

    filas.push({
      guiaId: guia.guiaId ?? guia.id,
      fecha: guia.fecha,
      choferNombre: guia.choferNombre,
      repartoNombre: guia.repartoNombre,
      estado: guia.estado,
      totalGuia: resumen.totales.totalGuia,
      netoARendir: resumen.totales.netoARendir,
      totalCtaCte: resumen.totales.totalCtaCte,
      cantidadAlertas: resumen.alertas.length,
      avisoFinReparto: !!guia.avisoFinReparto,
    });

    // Incidencias: no solo las alertas de "cobrado vs. condición nominal" (ya calculadas
    // en calcularTotalesYAlertas), sino también cada cliente parcial/no entregado — para
    // poder ver de un vistazo qué pedidos se rechazaron o se descontaron y por qué.
    resumen.clientes.forEach((c) => {
      if (c.estado === "parcial" || c.estado === "no_entregado") {
        incidencias.push({
          guiaId: guia.guiaId ?? guia.id,
          fecha: guia.fecha,
          choferNombre: guia.choferNombre,
          clienteId: c.clienteId,
          clienteNombre: c.nombre,
          tipo: c.estado === "no_entregado" ? "No entregado" : "Entrega parcial",
          montoDevuelto: c.montoDevuelto || 0,
          motivo: describirMotivoDevolucion(c.motivoDevolucion),
        });
      }
    });
    resumen.alertas.forEach((a) => {
      incidencias.push({
        guiaId: guia.guiaId ?? guia.id,
        fecha: guia.fecha,
        choferNombre: guia.choferNombre,
        clienteId: a.clienteId,
        clienteNombre: a.clienteNombre,
        tipo: a.motivo,
        montoDevuelto: null,
        motivo: a.detalle,
        alertaTipo: a.tipo,
      });
    });
  }

  const round2 = (n) => Math.round(n * 100) / 100;
  const filasOrdenadas = filas.sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
  // Choferes que avisaron que terminaron de repartir pero todavía no cerraron/rindieron
  // la guía — para que el panel de admin lo vea sin depender de un mensaje aparte.
  const avisos = filasOrdenadas.filter((f) => f.avisoFinReparto && f.estado === "abierta");
  return {
    kpis: {
      cantidadGuias: guiasEnRango.length,
      guiasAbiertas,
      guiasCerradas,
      totalGuias: round2(totalGuias),
      totalRecaudado: round2(totalRecaudado),
      totalPendienteCtaCte: round2(totalPendienteCtaCte),
      totalTransferencias: round2(totalTransferencias),
    },
    filas: filasOrdenadas,
    incidencias,
    avisos,
  };
}

import React from "react";
import { fmt } from "../utils/money";
import { describirCondicion } from "../lib/condiciones";
import { useToast } from "../hooks/useToast";

function csvEscape(v) {
  const s = String(v ?? "");
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function montoCsv(n) {
  return (n || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const ESTADO_LABEL = {
  pendiente: "Pendiente",
  completo: "Entregado",
  parcial: "Parcial",
  no_entregado: "No entregó",
};

// `onEliminarGuia` es opcional — solo lo pasa AdminGuiaDetalle.jsx. El chofer (App.jsx)
// nunca lo pasa, así que nunca ve la opción de borrar: borrar una guía es una acción de
// administración, no algo que el reparto normal necesite.
export default function Cierre({ guia, cierreData, onVolver, onEliminarGuia }) {
  const { showToast, toastNode } = useToast();
  const [confirmandoBorrado, setConfirmandoBorrado] = React.useState(false);
  const [borrando, setBorrando] = React.useState(false);

  async function handleEliminar() {
    if (!confirmandoBorrado) {
      setConfirmandoBorrado(true);
      return;
    }
    setBorrando(true);
    try {
      await onEliminarGuia();
    } catch (err) {
      showToast(err.message || "No se pudo borrar la guía.");
      setBorrando(false);
      setConfirmandoBorrado(false);
    }
  }
  if (!cierreData) {
    return (
      <div className="screen">
        <div className="app-bar">
          <button className="back" type="button" aria-label="Volver" onClick={onVolver}>
            ←
          </button>
          <div className="titles">
            <h2>Rendición</h2>
          </div>
        </div>
        <div className="scroll">
          <p>No hay datos de cierre todavía.</p>
        </div>
      </div>
    );
  }

  const { totales, alertas = [], cheques = [], transferencias = [], articulosDevueltos = [], clientes = [] } = cierreData;
  // Las pastillas de Devuelto / Cta. corriente / Transferencias / Cheques abren su detalle
  // consolidado de la guía al tocarlas, para que el chofer pueda controlarlo antes de
  // rendir — en vez de mostrar todo siempre, solo se ve el detalle de la que se tocó.
  const [abierto, setAbierto] = React.useState(null); // 'devuelto' | 'ctacte' | 'transferencia' | 'cheque' | null
  function toggleDetalle(key) {
    setAbierto((a) => (a === key ? null : key));
  }
  // Detectado con Germán el 2026-09-16 (guía 4295): clientes que ya transfirieron el pago
  // completo aparecían igual en "Clientes en cuenta corriente" mostrando $0 — quedaba un
  // resto de centavos en montoCtaCte por una diferencia de redondeo entre el monto de la
  // factura y el monto transferido, no una deuda real. Mismo criterio que ya se usa para
  // no alertar por redondeo (ver UMBRAL_ALERTA en src/data/guias.js): si el saldo es menor
  // a $1, no cuenta como cuenta corriente.
  const UMBRAL_CTACTE = 1;
  const clientesCtaCte = clientes.filter((c) => (c.montoCtaCte || 0) >= UMBRAL_CTACTE);
  // Además del consolidado por artículo, el panel de "Devuelto" muestra por quién quedó
  // la devolución — parcial o no entregado — con el importe devuelto de cada uno, para
  // poder controlar contra qué cliente corresponde cada devolución sin tener que abrir la
  // guía cliente por cliente.
  const clientesConDevolucion = clientes.filter((c) => c.estado === "parcial" || c.estado === "no_entregado");

  // El chofer necesita controlar el TOTAL físico devuelto por artículo (para cotejarlo
  // contra la mercadería que trae de vuelta en el camión), no una fila por cada cliente
  // que devolvió ese artículo — por eso acá se suman cantidad y monto de todas las líneas
  // que comparten código (o descripción, si el artículo no tiene código cargado).
  const articulosConsolidados = React.useMemo(() => {
    const porArticulo = new Map();
    articulosDevueltos.forEach((a) => {
      const key = a.codigo ? `cod:${a.codigo}` : `desc:${a.descripcion}`;
      const actual = porArticulo.get(key);
      if (actual) {
        actual.cantidadDevuelta += a.cantidadDevuelta;
        actual.monto = Math.round((actual.monto + a.monto) * 100) / 100;
        actual.clientes += 1;
      } else {
        porArticulo.set(key, {
          codigo: a.codigo || "",
          descripcion: a.descripcion,
          cantidadDevuelta: a.cantidadDevuelta,
          monto: a.monto,
          clientes: 1,
        });
      }
    });
    return Array.from(porArticulo.values()).sort((a, b) => a.descripcion.localeCompare(b.descripcion));
  }, [articulosDevueltos]);

  function descargarCsv() {
    const lines = [];
    lines.push("Rendición de guía;" + csvEscape(guia?.guiaId));
    lines.push("Reparto;" + csvEscape(guia?.repartoNombre || ""));
    lines.push("Chofer;" + csvEscape(guia?.choferNombre || ""));
    lines.push("");
    lines.push(
      [
        "Cliente",
        "Condición predeterminada",
        "Estado",
        "Total",
        "Devuelto",
        "Cobrado",
        "Cta. corriente",
      ].join(";")
    );
    clientes.forEach((c) => {
      lines.push(
        [
          csvEscape(c.nombre),
          csvEscape(describirCondicion(c.condicionPredeterminada)),
          csvEscape(ESTADO_LABEL[c.estado] || c.estado),
          montoCsv(c.montoTotal),
          montoCsv(c.montoDevuelto),
          montoCsv(c.montoCobrado),
          montoCsv(c.montoCtaCte),
        ].join(";")
      );
    });
    lines.push("");
    lines.push(["Detalle de cobranza por cheques"].join(";"));
    lines.push(["Cliente", "N° cheque", "Banco", "Fecha", "Monto"].join(";"));
    if (cheques.length === 0) {
      lines.push("Sin cheques cargados en esta guía");
    } else {
      cheques.forEach((ch) => {
        lines.push(
          [csvEscape(ch.clienteNombre), csvEscape(ch.numero || "s/n"), csvEscape(ch.banco || "s/d"), csvEscape(ch.fecha || "s/f"), montoCsv(ch.monto)].join(
            ";"
          )
        );
      });
    }
    lines.push("");
    lines.push(["Detalle de transferencias"].join(";"));
    // Mismas columnas que el reporte de CobrApp, a pedido de Germán — así se pueden
    // conciliar los dos reportes igual (ver DATA_MODEL.md).
    lines.push(
      [
        "Código cliente",
        "Nombre",
        "Monto",
        "Fecha",
        "Origen",
        "Destino",
        "Referencia",
        "Banco de Origen",
        "Banco de Destino",
        "CBU destino",
      ].join(";")
    );
    if (transferencias.length === 0) {
      lines.push("Sin transferencias cargadas en esta guía");
    } else {
      transferencias.forEach((t) => {
        lines.push(
          [
            csvEscape(t.clienteId ?? "s/d"),
            csvEscape(t.clienteNombre),
            montoCsv(t.monto),
            csvEscape(t.fecha || "s/f"),
            csvEscape(t.origen || "s/d"),
            csvEscape(t.destino || "s/d"),
            csvEscape(t.referencia || "s/d"),
            csvEscape(t.bancoOrigen || "s/d"),
            csvEscape(t.bancoDestino || "s/d"),
            csvEscape(t.cbuDestino || "s/d"),
          ].join(";")
        );
      });
    }
    lines.push("");
    lines.push(["Detalle de artículos devueltos"].join(";"));
    lines.push(["Cliente", "Código", "Descripción", "Cantidad", "N° comprobante", "Monto"].join(";"));
    if (articulosDevueltos.length === 0) {
      lines.push("Sin artículos devueltos en esta guía");
    } else {
      articulosDevueltos.forEach((a) => {
        lines.push(
          [
            csvEscape(a.clienteNombre),
            csvEscape(a.codigo || "s/d"),
            csvEscape(a.descripcion),
            montoCsv(a.cantidadDevuelta),
            csvEscape(a.comprobanteNumero),
            montoCsv(a.monto),
          ].join(";")
        );
      });
    }
    lines.push("");
    lines.push(["Total guía", montoCsv(totales.totalGuia)].join(";"));
    lines.push(["Devuelto", montoCsv(totales.totalDevuelto)].join(";"));
    lines.push(["Cuenta corriente", montoCsv(totales.totalCtaCte)].join(";"));
    lines.push(["Transferencias", montoCsv(totales.totalTransferencia)].join(";"));
    lines.push(["Efectivo", montoCsv(totales.totalEfectivo)].join(";"));
    lines.push(["Cheques", montoCsv(totales.totalCheque)].join(";"));
    lines.push(["Neto a rendir (efectivo + cheque)", montoCsv(totales.netoARendir)].join(";"));

    const csv = "﻿" + lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rendicion-guia-${guia?.guiaId || "s-n"}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast("CSV descargado.");
  }

  function imprimirPdf() {
    window.print();
  }

  function fechaHoraActual() {
    return new Date().toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
  }

  function compartirWhatsapp() {
    const alertasTxt =
      alertas.length === 0
        ? "Sin alertas."
        : alertas.map((a) => `• ${a.clienteNombre}: ${a.motivo} (${a.detalle})`).join("\n");
    const texto =
      `*Rendición guía #${guia?.guiaId}* — ${guia?.repartoNombre || ""}\n` +
      `Chofer: ${guia?.choferNombre || ""}\n\n` +
      `Total guía: ${fmt(totales.totalGuia)}\n` +
      `Devuelto: ${fmt(totales.totalDevuelto)}\n` +
      `Cta. corriente: ${fmt(totales.totalCtaCte)}\n` +
      `Transferencias: ${fmt(totales.totalTransferencia)}\n` +
      `Efectivo: ${fmt(totales.totalEfectivo)}\n` +
      `Cheques: ${fmt(totales.totalCheque)}\n` +
      `*Neto a rendir: ${fmt(totales.netoARendir)}*\n\n` +
      `Alertas:\n${alertasTxt}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, "_blank", "noopener");
  }

  return (
    <div className="screen">
      <div className="app-bar no-print">
        <button className="back" type="button" aria-label="Volver" onClick={onVolver}>
          ←
        </button>
        <div className="titles">
          <h2>Rendición</h2>
          <span className="sub">
            Guía #{guia?.guiaId} · {guia?.repartoNombre}
          </span>
        </div>
      </div>

      <div className="scroll no-print">
        {guia?.modificadoLuegoDeAviso && (
          <div className="alert-card">
            <span className="ic">⚠️</span>
            <span>
              <b>Se avisó que terminó el reparto y después se modificó algo</b>
              <span>Revisar los cambios antes de dar la rendición por buena.</span>
            </span>
          </div>
        )}

        <div className="totales-grid">
          <div className="tot-tile">
            <span className="lbl">Total guía</span>
            <span className="val">{fmt(totales.totalGuia)}</span>
          </div>
          <button type="button" className={`tot-tile clickable${abierto === "devuelto" ? " open" : ""}`} onClick={() => toggleDetalle("devuelto")}>
            <span className="lbl">Devuelto</span>
            <span className="val">{fmt(totales.totalDevuelto)}</span>
          </button>
          <button type="button" className={`tot-tile clickable${abierto === "ctacte" ? " open" : ""}`} onClick={() => toggleDetalle("ctacte")}>
            <span className="lbl">Cta. corriente</span>
            <span className="val">{fmt(totales.totalCtaCte)}</span>
          </button>
          <button type="button" className={`tot-tile clickable${abierto === "transferencia" ? " open" : ""}`} onClick={() => toggleDetalle("transferencia")}>
            <span className="lbl">Transferencias</span>
            <span className="val">{fmt(totales.totalTransferencia)}</span>
          </button>
          <div className="tot-tile">
            <span className="lbl">Efectivo</span>
            <span className="val">{fmt(totales.totalEfectivo)}</span>
          </div>
          <button type="button" className={`tot-tile clickable${abierto === "cheque" ? " open" : ""}`} onClick={() => toggleDetalle("cheque")}>
            <span className="lbl">Cheques</span>
            <span className="val">{fmt(totales.totalCheque)}</span>
          </button>
          <div className="tot-tile neto">
            <span className="lbl">Neto a rendir (efectivo + cheque)</span>
            <span className="val">{fmt(totales.netoARendir)}</span>
          </div>
        </div>

        {abierto === "devuelto" && (
          <div className="detalle-panel">
            <span className="dp-title">Artículos devueltos ({articulosConsolidados.length})</span>
            {articulosConsolidados.length === 0 ? (
              <span className="articulos-note">No se marcó ningún artículo devuelto en esta guía.</span>
            ) : (
              articulosConsolidados.map((a, i) => (
                <div className="cheque-report-row" key={i}>
                  <div className="cr-main">
                    <span className="cr-name">
                      {a.codigo && <>Cód. {a.codigo} · </>}
                      {a.descripcion}
                    </span>
                    <span className="cr-sub">
                      {a.cantidadDevuelta} un. en total
                      {a.clientes > 1 ? ` · ${a.clientes} clientes` : ""}
                    </span>
                  </div>
                  <span className="cr-amt">{fmt(a.monto)}</span>
                </div>
              ))
            )}

            <span className="dp-title" style={{ marginTop: 10 }}>
              Por cliente ({clientesConDevolucion.length})
            </span>
            {clientesConDevolucion.length === 0 ? (
              <span className="articulos-note">Ningún cliente quedó con devolución en esta guía.</span>
            ) : (
              clientesConDevolucion.map((c) => (
                <div className="cheque-report-row" key={c.clienteId}>
                  <div className="cr-main">
                    <span className="cr-name">{c.nombre}</span>
                    <span className="cr-sub">{c.estado === "no_entregado" ? "No entregó" : "Entrega parcial"}</span>
                  </div>
                  <span className="cr-amt">{fmt(c.montoDevuelto)}</span>
                </div>
              ))
            )}
          </div>
        )}

        {abierto === "ctacte" && (
          <div className="detalle-panel">
            <span className="dp-title">Clientes en cuenta corriente ({clientesCtaCte.length})</span>
            {clientesCtaCte.length === 0 ? (
              <span className="articulos-note">No quedó ningún cliente en cuenta corriente en esta guía.</span>
            ) : (
              clientesCtaCte.map((c) => (
                <div className="cheque-report-row" key={c.clienteId}>
                  <div className="cr-main">
                    <span className="cr-name">{c.nombre}</span>
                    <span className="cr-sub">{describirCondicion(c.condicionPredeterminada)}</span>
                  </div>
                  <span className="cr-amt">{fmt(c.montoCtaCte)}</span>
                </div>
              ))
            )}
          </div>
        )}

        {abierto === "transferencia" && (
          <div className="detalle-panel">
            <span className="dp-title">Detalle de transferencias ({transferencias.length})</span>
            {transferencias.length === 0 ? (
              <span className="articulos-note">No se cargaron transferencias en esta guía.</span>
            ) : (
              transferencias.map((t, i) => (
                <div className="cheque-report-row" key={i}>
                  <div className="cr-main">
                    <span className="cr-name">{t.clienteNombre}</span>
                    <span className="cr-sub">
                      {t.origen ? `De ${t.origen}` : "Origen sin datos"}
                      {t.bancoOrigen ? ` · ${t.bancoOrigen}` : ""}
                      {t.referencia ? ` · ${t.referencia}` : ""}
                    </span>
                  </div>
                  <span className="cr-amt">{fmt(t.monto)}</span>
                </div>
              ))
            )}
          </div>
        )}

        {abierto === "cheque" && (
          <div className="detalle-panel">
            <span className="dp-title">Detalle de cobranza por cheques ({cheques.length})</span>
            {cheques.length === 0 ? (
              <span className="articulos-note">No se cargaron cheques en esta guía.</span>
            ) : (
              cheques.map((ch, i) => (
                <div className="cheque-report-row" key={i}>
                  <div className="cr-main">
                    <span className="cr-name">{ch.clienteNombre}</span>
                    <span className="cr-sub">
                      N° {ch.numero || "s/n"} · {ch.banco || "Banco s/d"} · {ch.fecha || "s/f"}
                    </span>
                  </div>
                  <span className="cr-amt">{fmt(ch.monto)}</span>
                </div>
              ))
            )}
          </div>
        )}

        <div className="list-title">
          <h3>Alertas</h3>
          <span>{alertas.length}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {alertas.length === 0 ? (
            <div className="alert-card info">
              <span className="ic">✅</span>
              <span>
                <b>Sin alertas</b>
                <span>Lo cobrado coincide con la condición de venta de cada comprobante.</span>
              </span>
            </div>
          ) : (
            alertas.map((a, i) => (
              <div className={`alert-card${a.tipo === "info" ? " info" : ""}`} key={i}>
                <span className="ic">{a.tipo === "info" ? "ℹ️" : "⚠️"}</span>
                <span>
                  <b>
                    {a.clienteNombre} — {a.motivo}
                  </b>
                  <span>{a.detalle}</span>
                </span>
              </div>
            ))
          )}
        </div>

        <div className="list-title">
          <h3>Detalle por cliente</h3>
          <span>{clientes.length}</span>
        </div>
        <div className="table-scroll">
          <table className="detalle-cliente-table">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Cond. predeterminada</th>
                <th>Estado</th>
                <th>Total</th>
                <th>Devuelto</th>
                <th>Cobrado</th>
                <th>Cta. cte.</th>
              </tr>
            </thead>
            <tbody>
              {clientes.map((c) => (
                <tr key={c.clienteId}>
                  <td>{c.nombre}</td>
                  <td className="cond-tag">{describirCondicion(c.condicionPredeterminada)}</td>
                  <td>{ESTADO_LABEL[c.estado] || c.estado}</td>
                  <td className="num">{fmt(c.montoTotal)}</td>
                  <td className="num">{fmt(c.montoDevuelto)}</td>
                  <td className="num">{fmt(c.montoCobrado)}</td>
                  <td className="num">{fmt(c.montoCtaCte)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="export-row">
          <button className="btn btn-ghost" style={{ flex: 1 }} type="button" onClick={descargarCsv}>
            ⬇ Exportar CSV
          </button>
          <button className="btn btn-ghost" style={{ flex: 1 }} type="button" onClick={compartirWhatsapp}>
            ↗ WhatsApp
          </button>
          <button className="btn btn-ghost" style={{ flex: 1 }} type="button" onClick={imprimirPdf}>
            🖨 PDF
          </button>
        </div>

        {onEliminarGuia && (
          <div className="danger-zone">
            <span className="dp-title">Zona de peligro</span>
            <div className="export-row">
              <button
                className="btn btn-danger"
                style={{ flex: 1 }}
                type="button"
                disabled={borrando}
                onClick={handleEliminar}
              >
                {borrando ? "Borrando…" : confirmandoBorrado ? "¿Seguro? Tocá de nuevo para confirmar" : "🗑 Eliminar esta guía"}
              </button>
              {confirmandoBorrado && !borrando && (
                <button className="btn btn-ghost" type="button" onClick={() => setConfirmandoBorrado(false)}>
                  Cancelar
                </button>
              )}
            </div>
            <span className="articulos-note">
              Borra la guía y todos sus clientes de la base — pensado para limpiar guías de prueba. No se puede deshacer.
            </span>
          </div>
        )}
      </div>

      {/* Reporte para imprimir/PDF (botón "🖨 PDF" de arriba, dispara window.print()) — no
          se ve en pantalla (ver .print-report en styles.css), solo aparece al imprimir.
          Es un documento aparte de lo que se ve arriba: se arma de nuevo con las mismas
          tablas pero en blanco y negro, sin botones ni recuadros de color, pensado para
          guardar en papel o mandar como PDF. */}
      <div className="print-report">
        <div className="pr-header">
          <div>
            <h1>San Lorenzo Star</h1>
            <span>Rendición de reparto</span>
          </div>
          <div className="pr-header-meta">
            <span>Guía #{guia?.guiaId}</span>
            <span>Generado {fechaHoraActual()}</span>
          </div>
        </div>
        <table className="pr-meta-table">
          <tbody>
            <tr>
              <td>Reparto</td>
              <td>{guia?.repartoNombre || "—"}</td>
              <td>Chofer</td>
              <td>{guia?.choferNombre || "—"}</td>
            </tr>
            <tr>
              <td>Fecha guía</td>
              <td>{guia?.fecha || "—"}</td>
              <td>Estado</td>
              <td>{guia?.estado === "cerrada" ? "Cerrada" : "Abierta"}</td>
            </tr>
          </tbody>
        </table>

        {guia?.modificadoLuegoDeAviso && (
          <p className="pr-warn">
            ⚠ Se avisó que terminó el reparto y después se modificó algo — revisar los cambios antes de dar la
            rendición por buena.
          </p>
        )}

        <h2>Totales</h2>
        <table className="pr-totales-table">
          <tbody>
            <tr>
              <td>Total guía</td>
              <td className="num">{fmt(totales.totalGuia)}</td>
              <td>Transferencias</td>
              <td className="num">{fmt(totales.totalTransferencia)}</td>
            </tr>
            <tr>
              <td>Devuelto</td>
              <td className="num">{fmt(totales.totalDevuelto)}</td>
              <td>Efectivo</td>
              <td className="num">{fmt(totales.totalEfectivo)}</td>
            </tr>
            <tr>
              <td>Cta. corriente</td>
              <td className="num">{fmt(totales.totalCtaCte)}</td>
              <td>Cheques</td>
              <td className="num">{fmt(totales.totalCheque)}</td>
            </tr>
            <tr className="pr-neto-row">
              <td colSpan={3}>Neto a rendir (efectivo + cheque)</td>
              <td className="num">{fmt(totales.netoARendir)}</td>
            </tr>
          </tbody>
        </table>

        <h2>
          Alertas {alertas.length > 0 ? `(${alertas.length})` : ""}
        </h2>
        {alertas.length === 0 ? (
          <p>Sin alertas — lo cobrado coincide con la condición de venta de cada comprobante.</p>
        ) : (
          <ul className="pr-list">
            {alertas.map((a, i) => (
              <li key={i}>
                <b>
                  {a.clienteNombre} — {a.motivo}:
                </b>{" "}
                {a.detalle}
              </li>
            ))}
          </ul>
        )}

        <h2>Detalle por cliente ({clientes.length})</h2>
        <table className="pr-table">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Condición</th>
              <th>Estado</th>
              <th className="num">Total</th>
              <th className="num">Devuelto</th>
              <th className="num">Cobrado</th>
              <th className="num">Cta. cte.</th>
            </tr>
          </thead>
          <tbody>
            {clientes.map((c) => (
              <tr key={c.clienteId}>
                <td>{c.nombre}</td>
                <td>{describirCondicion(c.condicionPredeterminada)}</td>
                <td>{ESTADO_LABEL[c.estado] || c.estado}</td>
                <td className="num">{fmt(c.montoTotal)}</td>
                <td className="num">{fmt(c.montoDevuelto)}</td>
                <td className="num">{fmt(c.montoCobrado)}</td>
                <td className="num">{fmt(c.montoCtaCte)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {cheques.length > 0 && (
          <>
            <h2>Detalle de cheques ({cheques.length})</h2>
            <table className="pr-table">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>N° cheque</th>
                  <th>Banco</th>
                  <th>Fecha</th>
                  <th className="num">Monto</th>
                </tr>
              </thead>
              <tbody>
                {cheques.map((ch, i) => (
                  <tr key={i}>
                    <td>{ch.clienteNombre}</td>
                    <td>{ch.numero || "s/n"}</td>
                    <td>{ch.banco || "s/d"}</td>
                    <td>{ch.fecha || "s/f"}</td>
                    <td className="num">{fmt(ch.monto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {transferencias.length > 0 && (
          <>
            <h2>Detalle de transferencias ({transferencias.length})</h2>
            {/* Mismas columnas que el CSV de rendición y que el reporte de CobrApp, a pedido
                de Germán (ver DATA_MODEL.md) — así se puede conciliar directamente contra
                ese reporte sin tener que reordenar nada. */}
            <table className="pr-table pr-table-compact">
              <thead>
                <tr>
                  <th>Cód. cliente</th>
                  <th>Nombre</th>
                  <th className="num">Monto</th>
                  <th>Fecha</th>
                  <th>Origen</th>
                  <th>Destino</th>
                  <th>Referencia</th>
                  <th>Banco origen</th>
                  <th>Banco destino</th>
                  <th>CBU destino</th>
                </tr>
              </thead>
              <tbody>
                {transferencias.map((t, i) => (
                  <tr key={i}>
                    <td>{t.clienteId ?? "s/d"}</td>
                    <td>{t.clienteNombre}</td>
                    <td className="num">{fmt(t.monto)}</td>
                    <td>{t.fecha || "s/f"}</td>
                    <td>{t.origen || "s/d"}</td>
                    <td>{t.destino || "s/d"}</td>
                    <td>{t.referencia || "s/d"}</td>
                    <td>{t.bancoOrigen || "s/d"}</td>
                    <td>{t.bancoDestino || "s/d"}</td>
                    <td>{t.cbuDestino || "s/d"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {articulosConsolidados.length > 0 && (
          <>
            <h2>Artículos devueltos ({articulosConsolidados.length})</h2>
            <table className="pr-table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Descripción</th>
                  <th className="num">Cantidad</th>
                  <th className="num">Monto</th>
                </tr>
              </thead>
              <tbody>
                {articulosConsolidados.map((a, i) => (
                  <tr key={i}>
                    <td>{a.codigo || "—"}</td>
                    <td>{a.descripcion}</td>
                    <td className="num">{a.cantidadDevuelta}</td>
                    <td className="num">{fmt(a.monto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <div className="pr-firmas">
          <div className="pr-firma">
            <span className="pr-firma-linea" />
            <span>Firma chofer</span>
          </div>
          <div className="pr-firma">
            <span className="pr-firma-linea" />
            <span>Firma administración</span>
          </div>
        </div>
      </div>

      {toastNode}
    </div>
  );
}

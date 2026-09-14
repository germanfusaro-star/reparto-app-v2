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

export default function Cierre({ guia, cierreData, onVolver }) {
  const { showToast, toastNode } = useToast();
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
  const clientesCtaCte = clientes.filter((c) => (c.montoCtaCte || 0) > 0);

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
    lines.push(["Cliente", "Referencia", "Monto"].join(";"));
    if (transferencias.length === 0) {
      lines.push("Sin transferencias cargadas en esta guía");
    } else {
      transferencias.forEach((t) => {
        lines.push([csvEscape(t.clienteNombre), csvEscape(t.referencia || "s/d"), montoCsv(t.monto)].join(";"));
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
      <div className="app-bar">
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

      <div className="scroll">
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
            <span className="dp-title">Artículos devueltos ({articulosDevueltos.length})</span>
            {articulosDevueltos.length === 0 ? (
              <span className="articulos-note">No se marcó ningún artículo devuelto en esta guía.</span>
            ) : (
              articulosDevueltos.map((a, i) => (
                <div className="cheque-report-row" key={i}>
                  <div className="cr-main">
                    <span className="cr-name">{a.clienteNombre}</span>
                    <span className="cr-sub">
                      {a.codigo && <>Cód. {a.codigo} · </>}
                      {a.descripcion} · {a.cantidadDevuelta} un. · N° {a.comprobanteNumero}
                    </span>
                  </div>
                  <span className="cr-amt">{fmt(a.monto)}</span>
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
                    <span className="cr-sub">{t.referencia || "Sin referencia"}</span>
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
        </div>
      </div>
      {toastNode}
    </div>
  );
}

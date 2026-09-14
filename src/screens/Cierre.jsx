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

  const { totales, alertas = [], cheques = [], transferencias = [], clientes = [] } = cierreData;

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
          <div className="tot-tile">
            <span className="lbl">Devuelto</span>
            <span className="val">{fmt(totales.totalDevuelto)}</span>
          </div>
          <div className="tot-tile">
            <span className="lbl">Cta. corriente</span>
            <span className="val">{fmt(totales.totalCtaCte)}</span>
          </div>
          <div className="tot-tile">
            <span className="lbl">Transferencias</span>
            <span className="val">{fmt(totales.totalTransferencia)}</span>
          </div>
          <div className="tot-tile">
            <span className="lbl">Efectivo</span>
            <span className="val">{fmt(totales.totalEfectivo)}</span>
          </div>
          <div className="tot-tile">
            <span className="lbl">Cheques</span>
            <span className="val">{fmt(totales.totalCheque)}</span>
          </div>
          <div className="tot-tile neto">
            <span className="lbl">Neto a rendir (efectivo + cheque)</span>
            <span className="val">{fmt(totales.netoARendir)}</span>
          </div>
        </div>

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
          <h3>Detalle de cobranza por cheques</h3>
          <span>{cheques.length}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {cheques.length === 0 ? (
            <div className="alert-card info">
              <span className="ic">—</span>
              <span>
                <b>Sin cheques</b>
                <span>No se cargaron cheques en esta guía.</span>
              </span>
            </div>
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

        <div className="list-title">
          <h3>Detalle de transferencias</h3>
          <span>{transferencias.length}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {transferencias.length === 0 ? (
            <div className="alert-card info">
              <span className="ic">—</span>
              <span>
                <b>Sin transferencias</b>
                <span>No se cargaron transferencias en esta guía.</span>
              </span>
            </div>
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

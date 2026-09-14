import React from "react";
import { fmt } from "../utils/money";
import { describirCondicion, esperaCobroInmediato } from "../lib/condiciones";
import { avisarFinReparto } from "../data/guias";
import { useToast } from "../hooks/useToast";

const ESTADO_META = {
  pendiente: { label: "Pendiente", cls: "pendiente" },
  completo: { label: "Entregado", cls: "completo" },
  parcial: { label: "Parcial", cls: "parcial" },
  no_entregado: { label: "No entregó", cls: "no_entregado" },
};

export default function ListaClientes({ guia, clientes, choferNombre, onAbrirCliente, onCerrarGuia, loading }) {
  const total = guia.totalGuia || clientes.reduce((a, c) => a + (c.montoTotal || 0), 0);
  const visitados = clientes.filter((c) => c.estado !== "pendiente").length;
  const pct = clientes.length ? Math.round((visitados / clientes.length) * 100) : 0;
  const [avisando, setAvisando] = React.useState(false);
  const [avisado, setAvisado] = React.useState(!!guia.avisoFinReparto);
  const { showToast, toastNode } = useToast();

  // guia se refresca al volver de cargar una entrega (ver App.jsx) — si en el medio se
  // guardó algo, el aviso se destilda solo del lado del servidor; esto sincroniza el botón
  // con ese valor real en vez de quedarse con el "prendido" que puso el click anterior.
  React.useEffect(() => {
    setAvisado(!!guia.avisoFinReparto);
  }, [guia.avisoFinReparto]);

  async function handleAvisar() {
    setAvisando(true);
    try {
      await avisarFinReparto(guia.guiaId);
      setAvisado(true);
      showToast("Aviso enviado — ya se ve en el panel de administración.");
    } catch (err) {
      showToast(err.message || "No se pudo enviar el aviso. Reintentá.");
    } finally {
      setAvisando(false);
    }
  }

  return (
    <div className="screen lista-screen">
      <div className="app-bar">
        <div className="titles">
          <h2>Reparto de hoy</h2>
          <span className="sub">{choferNombre}</span>
        </div>
      </div>
      <div className="scroll">
        <div className="summary-card">
          <div className="row1">
            <span className="guia-id">Guía #{guia.guiaId}</span>
            <span className="zona">{guia.repartoNombre}</span>
          </div>
          <div>
            <div className="total">{fmt(total)}</div>
            <div className="meta">{visitados} de {clientes.length} clientes visitados</div>
          </div>
          <div className="progress-track"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
        </div>

        <div className="list-title"><h3>Clientes</h3><span>{clientes.length}</span></div>
        <div className="client-list">
          {clientes.map((c) => {
            const meta = ESTADO_META[c.estado] || ESTADO_META.pendiente;
            const contado = esperaCobroInmediato(c.condicionPredeterminada);
            return (
              <button key={c.clienteId} type="button" className="client-card" onClick={() => onAbrirCliente(c.clienteId)}>
                <div className="info">
                  <span className="name">{c.nombre}</span>
                  <span className="addr">{c.direccion}</span>
                  <span className={`cond-badge ${contado ? "contado" : "ctacte"}`}>
                    {describirCondicion(c.condicionPredeterminada)}
                  </span>
                </div>
                <span className="amt">{fmt(c.montoTotal)}</span>
                <span className={`pill ${meta.cls}`}>{meta.label}</span>
                <span className="chevron">›</span>
              </button>
            );
          })}
        </div>

        <button
          className={`btn ${avisado ? "btn-ghost" : "btn-primary"} btn-block`}
          type="button"
          style={{ marginTop: 4 }}
          disabled={avisando || avisado}
          onClick={handleAvisar}
        >
          {avisado ? "✓ Avisaste que terminaste el reparto" : avisando ? "Avisando…" : "📣 Avisar que terminé el reparto"}
        </button>

        <button
          className="btn btn-primary btn-block"
          type="button"
          style={{ marginTop: 4 }}
          disabled={loading}
          onClick={onCerrarGuia}
        >
          {loading ? "Cerrando…" : "Cerrar guía y ver rendición"}
        </button>
      </div>
      {toastNode}
    </div>
  );
}

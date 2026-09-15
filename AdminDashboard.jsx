import React from "react";
import { fmt } from "../../utils/money";
import { calcularResumenGlobal } from "../../data/admin";
import { cerrarSesionAdmin } from "../adminAuth";

const FILTROS = [
  { k: "hoy", label: "Hoy" },
  { k: "7d", label: "7 días" },
  { k: "30d", label: "30 días" },
  { k: "todo", label: "Todo" },
];

const ESTADO_LABEL = { abierta: "Abierta", cerrada: "Cerrada" };

function isoHoy() {
  return new Date().toISOString().slice(0, 10);
}
function isoHaceNDias(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function rangoDe(filtro) {
  const hasta = isoHoy();
  if (filtro === "hoy") return { desde: hasta, hasta };
  if (filtro === "7d") return { desde: isoHaceNDias(6), hasta };
  if (filtro === "30d") return { desde: isoHaceNDias(29), hasta };
  return {}; // todo
}

function formatoHora(d) {
  return d ? d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : "";
}

export default function AdminDashboard({ onAbrirGuia, onAbrirChoferes }) {
  const [filtro, setFiltro] = React.useState("7d");
  const [resumen, setResumen] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [actualizadoEn, setActualizadoEn] = React.useState(null);

  async function cargar(conSpinner) {
    if (conSpinner) setLoading(true);
    try {
      const r = await calcularResumenGlobal(rangoDe(filtro));
      setResumen(r);
      setActualizadoEn(new Date());
      setError(null);
    } catch (err) {
      setError(err.message || "No se pudo cargar el resumen.");
    } finally {
      if (conSpinner) setLoading(false);
    }
  }

  React.useEffect(() => {
    cargar(true);
    // El panel no se actualiza solo con Firestore (no hay una suscripción en vivo, se
    // trae todo con getDocs) — por eso, para que una guía nueva o un aviso de fin de
    // reparto no se queden "atrás" mientras alguien tiene esta pantalla abierta, se
    // refresca solo cada 45s (nada más si la pestaña está visible, para no gastar
    // lecturas de más de fondo).
    const id = setInterval(() => {
      if (document.visibilityState === "visible") cargar(false);
    }, 45000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtro]);

  return (
    <div className="screen">
      <div className="app-bar admin-topbar">
        <div className="titles">
          <h2>Panel de rendiciones</h2>
          <span className="sub">San Lorenzo Star</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost" type="button" onClick={onAbrirChoferes}>
            Choferes
          </button>
          <button className="btn btn-ghost" type="button" onClick={cerrarSesionAdmin}>
            Salir
          </button>
        </div>
      </div>

      <div className="scroll">
        <div className="filtro-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div className="filtro-row" style={{ padding: 0 }}>
            {FILTROS.map((f) => (
              <button
                key={f.k}
                type="button"
                className={`filtro-chip${filtro === f.k ? " on" : ""}`}
                onClick={() => setFiltro(f.k)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {actualizadoEn && (
              <span style={{ fontSize: ".72rem", color: "var(--text-muted)" }}>
                Actualizado {formatoHora(actualizadoEn)}
              </span>
            )}
            <button className="btn btn-ghost" type="button" onClick={() => cargar(true)} disabled={loading}>
              {loading ? "Actualizando…" : "🔄 Actualizar"}
            </button>
          </div>
        </div>

        {error && (
          <div className="alert-card">
            <span className="ic">⚠️</span>
            <span>{error}</span>
          </div>
        )}

        {loading && !resumen ? (
          <p>Cargando…</p>
        ) : resumen ? (
          <>
            <div className="kpi-grid">
              <div className="kpi-tile">
                <span className="lbl">Guías</span>
                <span className="val">{resumen.kpis.cantidadGuias}</span>
                <span className="sub">
                  {resumen.kpis.guiasAbiertas} abiertas · {resumen.kpis.guiasCerradas} cerradas
                </span>
              </div>
              <div className="kpi-tile">
                <span className="lbl">Total en guías</span>
                <span className="val">{fmt(resumen.kpis.totalGuias)}</span>
              </div>
              <div className="kpi-tile">
                <span className="lbl">Transferencias</span>
                <span className="val">{fmt(resumen.kpis.totalTransferencias)}</span>
              </div>
              <div className="kpi-tile">
                <span className="lbl">Pendiente cta. cte.</span>
                <span className="val">{fmt(resumen.kpis.totalPendienteCtaCte)}</span>
              </div>
              <div className="kpi-tile neto">
                <span className="lbl">Neto a rendir (efectivo + cheque)</span>
                <span className="val">{fmt(resumen.kpis.totalRecaudado)}</span>
              </div>
            </div>

            {resumen.avisosModificados.length > 0 && (
              <>
                <div className="list-title">
                  <h3>⚠️ Avisaron pero modificaron algo después</h3>
                  <span>{resumen.avisosModificados.length}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 4 }}>
                  {resumen.avisosModificados.map((f) => (
                    <div className="alert-card clickable-row" key={f.guiaId} onClick={() => onAbrirGuia(f.guiaId)}>
                      <span className="ic">⚠️</span>
                      <span>
                        <b>
                          {f.choferNombre} — Guía #{f.guiaId}
                        </b>
                        <span>{f.repartoNombre} · avisó que terminó y después cargó o corrigió algo — revisar antes de cerrar</span>
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {resumen.avisos.length > 0 && (
              <>
                <div className="list-title">
                  <h3>📣 Avisaron que terminaron</h3>
                  <span>{resumen.avisos.length}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 4 }}>
                  {resumen.avisos.map((f) => (
                    <div className="alert-card info clickable-row" key={f.guiaId} onClick={() => onAbrirGuia(f.guiaId)}>
                      <span className="ic">📣</span>
                      <span>
                        <b>
                          {f.choferNombre} — Guía #{f.guiaId}
                        </b>
                        <span>{f.repartoNombre} · todavía no cerró/rindió la guía</span>
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="list-title">
              <h3>Guías</h3>
              <span>{resumen.filas.length}</span>
            </div>
            <div className="table-scroll">
              <table className="detalle-cliente-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Guía</th>
                    <th>Chofer</th>
                    <th>Reparto</th>
                    <th>Estado</th>
                    <th>Total</th>
                    <th>Neto a rendir</th>
                    <th>Cta. cte.</th>
                    <th>Alertas</th>
                  </tr>
                </thead>
                <tbody>
                  {resumen.filas.length === 0 && (
                    <tr>
                      <td colSpan={9}>Sin guías en este rango.</td>
                    </tr>
                  )}
                  {resumen.filas.map((f) => (
                    <tr key={f.guiaId} className="clickable-row" onClick={() => onAbrirGuia(f.guiaId)}>
                      <td>{f.fecha}</td>
                      <td>#{f.guiaId}</td>
                      <td>{f.choferNombre}</td>
                      <td>{f.repartoNombre}</td>
                      <td>
                        <span className={`estado-badge ${f.estado}`}>{ESTADO_LABEL[f.estado] || f.estado}</span>
                        {f.modificadoLuegoDeAviso ? (
                          <span title="Avisó que terminó y después cargó o corrigió algo, sin volver a avisar">
                            {" "}
                            ⚠️
                          </span>
                        ) : (
                          f.avisoFinReparto && (
                            <span title={f.estado === "abierta" ? "Avisó que terminó" : "Avisó que terminó antes de cerrar la guía"}>
                              {" "}
                              📣
                            </span>
                          )
                        )}
                      </td>
                      <td className="num">{fmt(f.totalGuia)}</td>
                      <td className="num">{fmt(f.netoARendir)}</td>
                      <td className="num">{fmt(f.totalCtaCte)}</td>
                      <td className="num">{f.cantidadAlertas || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="list-title">
              <h3>Incidencias — rechazos, parciales y alertas</h3>
              <span>{resumen.incidencias.length}</span>
            </div>
            <div className="table-scroll">
              <table className="detalle-cliente-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Guía</th>
                    <th>Chofer</th>
                    <th>Cliente</th>
                    <th>Tipo</th>
                    <th>Detalle / motivo</th>
                    <th>Devuelto</th>
                  </tr>
                </thead>
                <tbody>
                  {resumen.incidencias.length === 0 && (
                    <tr>
                      <td colSpan={7}>Sin incidencias en este rango.</td>
                    </tr>
                  )}
                  {resumen.incidencias.map((inc, i) => (
                    <tr key={i} className="clickable-row" onClick={() => onAbrirGuia(inc.guiaId)}>
                      <td>{inc.fecha}</td>
                      <td>#{inc.guiaId}</td>
                      <td>{inc.choferNombre}</td>
                      <td>{inc.clienteNombre}</td>
                      <td>{inc.tipo}</td>
                      <td>{inc.motivo || "—"}</td>
                      <td className="num">{inc.montoDevuelto != null ? fmt(inc.montoDevuelto) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

import React from "react";
import { listarChoferes, agregarChofer, eliminarChofer } from "../../data/choferes";
import { useToast } from "../../hooks/useToast";

export default function AdminChoferes({ onVolver }) {
  const [choferes, setChoferes] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [nombreNuevo, setNombreNuevo] = React.useState("");
  const [guardando, setGuardando] = React.useState(false);
  const { showToast, toastNode } = useToast();

  async function cargar() {
    setLoading(true);
    setError(null);
    try {
      setChoferes(await listarChoferes());
    } catch (err) {
      setError(err.message || "No se pudo cargar la lista de choferes.");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    cargar();
  }, []);

  async function handleAgregar(e) {
    e.preventDefault();
    if (!nombreNuevo.trim() || guardando) return;
    setGuardando(true);
    try {
      await agregarChofer(nombreNuevo);
      setNombreNuevo("");
      await cargar();
      showToast("Chofer agregado.");
    } catch (err) {
      showToast(err.message || "No se pudo agregar el chofer.");
    } finally {
      setGuardando(false);
    }
  }

  async function handleEliminar(id, nombre) {
    try {
      await eliminarChofer(id);
      setChoferes((list) => list.filter((c) => c.id !== id));
      showToast(`${nombre} eliminado.`);
    } catch (err) {
      showToast(err.message || "No se pudo eliminar.");
    }
  }

  return (
    <div className="screen">
      <div className="app-bar">
        <button className="back" type="button" aria-label="Volver" onClick={onVolver}>
          ←
        </button>
        <div className="titles">
          <h2>Choferes</h2>
          <span className="sub">Lista del desplegable de la app</span>
        </div>
      </div>

      <div className="scroll">
        {error && (
          <div className="alert-card">
            <span className="ic">⚠️</span>
            <span>{error}</span>
          </div>
        )}

        <form className="card detail-block" onSubmit={handleAgregar}>
          <h4>Agregar chofer</h4>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <div className="field" style={{ flex: 1, marginBottom: 0 }}>
              <label htmlFor="nombreNuevo">Nombre</label>
              <input
                id="nombreNuevo"
                type="text"
                placeholder="Ej. Roberto Quintana"
                value={nombreNuevo}
                onChange={(e) => setNombreNuevo(e.target.value)}
              />
            </div>
            <button className="btn btn-primary" type="submit" disabled={guardando}>
              {guardando ? "Agregando…" : "+ Agregar"}
            </button>
          </div>
        </form>

        <div className="list-title">
          <h3>Choferes cargados</h3>
          <span>{choferes.length}</span>
        </div>

        {loading ? (
          <p>Cargando…</p>
        ) : choferes.length === 0 ? (
          <div className="alert-card info">
            <span className="ic">—</span>
            <span>
              <b>Sin choferes</b>
              <span>Agregá el primero arriba.</span>
            </span>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {choferes.map((c) => (
              <div className="cheque-report-row" key={c.id}>
                <div className="cr-main">
                  <span className="cr-name">{c.nombre}</span>
                </div>
                <button
                  type="button"
                  className="ci-rm"
                  aria-label={`Eliminar ${c.nombre}`}
                  onClick={() => handleEliminar(c.id, c.nombre)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      {toastNode}
    </div>
  );
}

import React from "react";
import Cierre from "../../screens/Cierre.jsx";
import { obtenerGuia } from "../../data/guias";
import { calcularResumenGuia } from "../../data/admin";

// Reusa la misma pantalla de rendición que ve el chofer al cerrar la guía — el panel de
// admin solo la abre en modo lectura para cualquier guía (esté abierta o cerrada), en
// vez de tener que esperar a que el chofer la cierre para poder revisarla.
export default function AdminGuiaDetalle({ guiaId, onVolver }) {
  const [guia, setGuia] = React.useState(null);
  const [cierreData, setCierreData] = React.useState(null);
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    let cancelado = false;
    setGuia(null);
    setCierreData(null);
    setError(null);
    Promise.all([obtenerGuia(guiaId), calcularResumenGuia(guiaId)])
      .then(([g, resumen]) => {
        if (cancelado) return;
        setGuia(g);
        setCierreData(resumen);
      })
      .catch((err) => !cancelado && setError(err.message || "No se pudo cargar la guía."));
    return () => {
      cancelado = true;
    };
  }, [guiaId]);

  if (error) {
    return (
      <div className="screen">
        <div className="app-bar">
          <button className="back" type="button" aria-label="Volver" onClick={onVolver}>
            ←
          </button>
          <div className="titles">
            <h2>Guía #{guiaId}</h2>
          </div>
        </div>
        <div className="scroll">
          <div className="alert-card">
            <span className="ic">⚠️</span>
            <span>{error}</span>
          </div>
        </div>
      </div>
    );
  }

  if (!guia) {
    return (
      <div className="screen">
        <div className="scroll">
          <p>Cargando…</p>
        </div>
      </div>
    );
  }

  return <Cierre guia={guia} cierreData={cierreData} onVolver={onVolver} />;
}

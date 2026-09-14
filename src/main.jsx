import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import AdminApp from "./admin/AdminApp.jsx";
import { ensureAnonAuth } from "./auth";
import "./styles.css";

// La app del chofer y el panel de administración conviven en el mismo build (mismo
// repo, mismo deploy en Vercel) pero son dos experiencias separadas por ruta:
// "/" es la app del chofer (sesión anónima automática), "/admin" es el panel de
// administración (usuario y contraseña reales, ver src/admin/). No usamos una librería
// de routing porque es solo esta bifurcación — vercel.json tiene el rewrite para que
// entrar directo a /admin (no solo navegando desde "/") también funcione.
const esAdmin = window.location.pathname.startsWith("/admin");

function Boot() {
  const [ready, setReady] = React.useState(false);
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    ensureAnonAuth()
      .then(() => setReady(true))
      .catch((err) => setError(err));
  }, []);

  if (error) {
    return (
      <div className="boot-error">
        <p>No se pudo conectar con Firebase.</p>
        <p className="boot-error-detail">{error.message}</p>
      </div>
    );
  }
  if (!ready) {
    return <div className="boot-loading">Iniciando…</div>;
  }
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>{esAdmin ? <AdminApp /> : <Boot />}</React.StrictMode>
);

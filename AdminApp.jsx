import React from "react";
import AdminLogin from "./screens/AdminLogin.jsx";
import AdminDashboard from "./screens/AdminDashboard.jsx";
import AdminGuiaDetalle from "./screens/AdminGuiaDetalle.jsx";
import AdminChoferes from "./screens/AdminChoferes.jsx";
import { esUsuarioAdmin, suscribirseAAuth } from "./adminAuth";

export default function AdminApp() {
  const [authReady, setAuthReady] = React.useState(false);
  const [autenticado, setAutenticado] = React.useState(false);
  const [screen, setScreen] = React.useState("dashboard"); // "dashboard" | "detalle" | "choferes"
  const [guiaSeleccionada, setGuiaSeleccionada] = React.useState(null);

  React.useEffect(() => {
    const unsubscribe = suscribirseAAuth((user) => {
      setAutenticado(esUsuarioAdmin(user));
      setAuthReady(true);
    });
    return unsubscribe;
  }, []);

  if (!authReady) {
    return <div className="boot-loading">Cargando…</div>;
  }

  if (!autenticado) {
    return (
      <div className="app-root admin-root">
        <AdminLogin />
      </div>
    );
  }

  return (
    <div className="app-root admin-root">
      {screen === "dashboard" && (
        <AdminDashboard
          onAbrirGuia={(guiaId) => {
            setGuiaSeleccionada(guiaId);
            setScreen("detalle");
          }}
          onAbrirChoferes={() => setScreen("choferes")}
        />
      )}
      {screen === "detalle" && (
        <AdminGuiaDetalle guiaId={guiaSeleccionada} onVolver={() => setScreen("dashboard")} />
      )}
      {screen === "choferes" && <AdminChoferes onVolver={() => setScreen("dashboard")} />}
    </div>
  );
}

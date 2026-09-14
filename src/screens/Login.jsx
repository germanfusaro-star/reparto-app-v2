import React from "react";
import logoIcon from "../../assets/logo-icon.png";
import { listarChoferes } from "../data/choferes";

export default function Login({ onIniciar, loading }) {
  const [choferes, setChoferes] = React.useState([]);
  const [cargandoChoferes, setCargandoChoferes] = React.useState(true);
  const [errorChoferes, setErrorChoferes] = React.useState(null);
  const [chofer, setChofer] = React.useState("");
  const [guiaId, setGuiaId] = React.useState("");

  React.useEffect(() => {
    let cancelado = false;
    listarChoferes()
      .then((lista) => {
        if (cancelado) return;
        setChoferes(lista);
        if (lista.length) setChofer(lista[0].nombre);
      })
      .catch((err) => !cancelado && setErrorChoferes(err.message || "No se pudo cargar la lista de choferes."))
      .finally(() => !cancelado && setCargandoChoferes(false));
    return () => {
      cancelado = true;
    };
  }, []);

  function handleSubmit(e) {
    e.preventDefault();
    if (!chofer || !guiaId.trim() || loading) return;
    onIniciar(chofer, guiaId.trim());
  }

  return (
    <div className="screen login-screen">
      <div className="login-wrap">
        <div className="brand-mark">
          <img className="brand-logo" src={logoIcon} alt="San Lorenzo Star" />
          <h1>RepartoApp <span style={{ fontSize: ".5em", opacity: 0.7 }}>2.0 (prueba)</span></h1>
          <p>San Lorenzo Star · reparto y cobranza</p>
        </div>
        <form className="card login-card" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="choferSel">Chofer</label>
            {cargandoChoferes ? (
              <p className="login-note">Cargando choferes…</p>
            ) : errorChoferes ? (
              <p className="login-note">{errorChoferes}</p>
            ) : choferes.length === 0 ? (
              <p className="login-note">
                Todavía no hay choferes cargados — se agregan desde el panel de
                administración (/admin → Choferes).
              </p>
            ) : (
              <select id="choferSel" value={chofer} onChange={(e) => setChofer(e.target.value)}>
                {choferes.map((c) => (
                  <option key={c.id} value={c.nombre}>
                    {c.nombre}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="field">
            <label htmlFor="guiaInput">Número de guía</label>
            <input
              id="guiaInput"
              inputMode="numeric"
              value={guiaId}
              onChange={(e) => setGuiaId(e.target.value)}
              placeholder="Ej. 4277"
            />
          </div>
          <button className="btn btn-primary btn-block" type="submit" disabled={loading || !chofer}>
            {loading ? "Buscando guía…" : "Iniciar reparto"}
          </button>
          <p className="login-note">Solo este paso necesita señal — trae el manifiesto de BigQuery.</p>
        </form>
      </div>
    </div>
  );
}

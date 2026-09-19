import React from "react";
import logoIcon from "../../assets/logo-icon.png";
import { listarChoferes } from "../data/choferes";
import { buscarGuiaAbiertaDeChofer } from "../data/guias";

export default function Login({ onIniciar, loading }) {
  const [choferes, setChoferes] = React.useState([]);
  const [cargandoChoferes, setCargandoChoferes] = React.useState(true);
  const [errorChoferes, setErrorChoferes] = React.useState(null);
  const [chofer, setChofer] = React.useState("");
  const [guiaId, setGuiaId] = React.useState("");
  // Red de seguridad para cuando la sesión guardada en el celular se perdió (ver
  // App.jsx / lib/sesion.js): si el chofer elegido ya tiene una guía abierta en
  // Firestore, se la ofrecemos para retomar en vez de pedirle que tipee el número de
  // nuevo — así "loguearse de nuevo" (elegir su nombre) alcanza para volver a entrar.
  const [guiaAbierta, setGuiaAbierta] = React.useState(null);
  const [buscandoGuiaAbierta, setBuscandoGuiaAbierta] = React.useState(false);
  const [forzarGuiaManual, setForzarGuiaManual] = React.useState(false);

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

  React.useEffect(() => {
    let cancelado = false;
    setGuiaAbierta(null);
    setForzarGuiaManual(false);
    if (!chofer) return;
    setBuscandoGuiaAbierta(true);
    buscarGuiaAbiertaDeChofer(chofer)
      .then((g) => {
        if (!cancelado) setGuiaAbierta(g);
      })
      .catch(() => {
        // Si falla la búsqueda (p.ej. sin señal), no bloquea nada — el chofer sigue
        // pudiendo tipear el número de guía a mano como siempre.
      })
      .finally(() => !cancelado && setBuscandoGuiaAbierta(false));
    return () => {
      cancelado = true;
    };
  }, [chofer]);

  const mostrarGuiaAbierta = guiaAbierta && !forzarGuiaManual;

  function handleSubmit(e) {
    e.preventDefault();
    if (!chofer || loading) return;
    if (mostrarGuiaAbierta) {
      onIniciar(chofer, guiaAbierta.id);
      return;
    }
    if (!guiaId.trim()) return;
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
          {mostrarGuiaAbierta ? (
            <div className="field">
              <p className="login-note login-guia-abierta">
                {chofer} ya tiene la guía <strong>#{guiaAbierta.id}</strong> abierta
                {guiaAbierta.fecha ? ` (${guiaAbierta.fecha})` : ""} — se retoma donde quedó.
              </p>
              <button
                type="button"
                className="btn btn-link"
                onClick={() => setForzarGuiaManual(true)}
              >
                No es esta guía, tipear otro número
              </button>
            </div>
          ) : (
            <div className="field">
              <label htmlFor="guiaInput">Número de guía</label>
              <input
                id="guiaInput"
                inputMode="numeric"
                value={guiaId}
                onChange={(e) => setGuiaId(e.target.value)}
                placeholder="Ej. 4277"
              />
              {forzarGuiaManual && guiaAbierta && (
                <button
                  type="button"
                  className="btn btn-link"
                  onClick={() => setForzarGuiaManual(false)}
                >
                  Volver a la guía #{guiaAbierta.id} abierta
                </button>
              )}
            </div>
          )}
          <button
            className="btn btn-primary btn-block"
            type="submit"
            disabled={loading || !chofer || buscandoGuiaAbierta || (!mostrarGuiaAbierta && !guiaId.trim())}
          >
            {loading
              ? "Buscando guía…"
              : buscandoGuiaAbierta
              ? "Revisando si ya tenés una guía abierta…"
              : mostrarGuiaAbierta
              ? "Continuar reparto"
              : "Iniciar reparto"}
          </button>
          <p className="login-note">Solo este paso necesita señal — trae el manifiesto de BigQuery.</p>
        </form>
      </div>
    </div>
  );
}

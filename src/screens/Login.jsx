import React from "react";
import logoIcon from "../../assets/logo-icon.png";
import { listarChoferes } from "../data/choferes";
import { buscarGuiaAbiertaDeChofer } from "../data/guias";

// La búsqueda de guía abierta necesita señal — si el celular está sin cobertura (muy
// común manejando entre repartos) la consulta a Firestore puede tardar mucho en avisar
// que no hay conexión. Con este límite, a los 6s se la da por perdida y el chofer sigue
// pudiendo tipear el número de guía a mano sin haber estado nunca bloqueado esperando.
const TIMEOUT_BUSQUEDA_MS = 6000;

export default function Login({ onIniciar, loading }) {
  const [choferes, setChoferes] = React.useState([]);
  const [cargandoChoferes, setCargandoChoferes] = React.useState(true);
  const [errorChoferes, setErrorChoferes] = React.useState(null);
  const [chofer, setChofer] = React.useState("");
  const [guiaId, setGuiaId] = React.useState("");
  // Red de seguridad para cuando la sesión guardada en el celular se perdió (ver
  // App.jsx / lib/sesion.js): si el chofer elegido ya tiene una guía abierta en
  // Firestore, se la ofrecemos para retomar con un botón aparte, ADEMÁS del campo de
  // número de guía de siempre (nunca lo reemplaza ni lo bloquea) — así, si la consulta
  // tarda o falla por falta de señal, el chofer igual puede tipear el número a mano sin
  // haber esperado nada.
  const [guiaAbierta, setGuiaAbierta] = React.useState(null);
  const [buscandoGuiaAbierta, setBuscandoGuiaAbierta] = React.useState(false);
  const [ocultarGuiaAbierta, setOcultarGuiaAbierta] = React.useState(false);

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
    setOcultarGuiaAbierta(false);
    if (!chofer) return;
    setBuscandoGuiaAbierta(true);
    const conTimeout = Promise.race([
      buscarGuiaAbiertaDeChofer(chofer),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), TIMEOUT_BUSQUEDA_MS)),
    ]);
    conTimeout
      .then((g) => {
        if (!cancelado) setGuiaAbierta(g);
      })
      .catch(() => {
        // Si falla o tarda demasiado (p.ej. sin señal), no bloquea nada — el campo de
        // número de guía siempre estuvo disponible mientras tanto.
      })
      .finally(() => !cancelado && setBuscandoGuiaAbierta(false));
    return () => {
      cancelado = true;
    };
  }, [chofer]);

  const mostrarGuiaAbierta = guiaAbierta && !ocultarGuiaAbierta;

  function handleContinuar() {
    if (!chofer || loading || !guiaAbierta) return;
    onIniciar(chofer, guiaAbierta.id);
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!chofer || loading || !guiaId.trim()) return;
    onIniciar(chofer, guiaId.trim());
  }

  return (
    <div className="screen login-screen">
      <div className="login-wrap">
        <div className="brand-mark">
          <img className="brand-logo" src={logoIcon} alt="San Lorenzo Star" />
          <h1>RepartoApp <span style={{ fontSize: ".5em", opacity: 0.7 }}>2.0</span></h1>
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
          {mostrarGuiaAbierta && (
            <div className="field">
              <p className="login-note login-guia-abierta">
                {chofer} ya tiene la guía <strong>#{guiaAbierta.id}</strong> abierta
                {guiaAbierta.fecha ? ` (${guiaAbierta.fecha})` : ""}.
              </p>
              <button type="button" className="btn btn-ghost btn-block" onClick={handleContinuar} disabled={loading}>
                Continuar guía #{guiaAbierta.id}
              </button>
              <button type="button" className="btn btn-link" onClick={() => setOcultarGuiaAbierta(true)}>
                No es esta guía
              </button>
            </div>
          )}
          {/* El campo de número de guía queda siempre visible y nunca se bloquea — si la
              revisión de arriba tarda o falla por falta de señal, el chofer igual puede
              tipear el número a mano sin haber esperado nada (ver TIMEOUT_BUSQUEDA_MS). */}
          <div className="field">
            <label htmlFor="guiaInput">
              {mostrarGuiaAbierta ? "O tipear otro número de guía" : "Número de guía"}
            </label>
            <input
              id="guiaInput"
              inputMode="numeric"
              value={guiaId}
              onChange={(e) => setGuiaId(e.target.value)}
              placeholder="Ej. 4277"
            />
          </div>
          <button className="btn btn-primary btn-block" type="submit" disabled={loading || !chofer || !guiaId.trim()}>
            {loading ? "Buscando guía…" : "Iniciar reparto"}
          </button>
          <p className="login-note">
            {buscandoGuiaAbierta
              ? "Revisando si ya tenés una guía abierta…"
              : "Solo este paso necesita señal — trae el manifiesto de BigQuery."}
          </p>
        </form>
      </div>
    </div>
  );
}

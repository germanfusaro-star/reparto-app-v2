import React from "react";
import Login from "./screens/Login.jsx";
import ListaClientes from "./screens/ListaClientes.jsx";
import DetalleCliente from "./screens/DetalleCliente.jsx";
import Cierre from "./screens/Cierre.jsx";
import {
  obtenerGuia,
  crearGuiaDesdeManifiesto,
  listarClientes,
  cerrarGuia,
  listarChequesDeGuia,
  listarTransferenciasDeGuia,
  listarArticulosDevueltosDeGuia,
} from "./data/guias";
import { guardarSesion, leerSesion, borrarSesion } from "./lib/sesion";

export default function App() {
  const [screen, setScreen] = React.useState("login");
  const [guiaId, setGuiaId] = React.useState(null);
  const [guia, setGuia] = React.useState(null);
  const [choferNombre, setChoferNombre] = React.useState("");
  const [clientes, setClientes] = React.useState([]);
  const [selectedClienteId, setSelectedClienteId] = React.useState(null);
  const [cierreData, setCierreData] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState(null);

  async function refreshClientes(id) {
    const lista = await listarClientes(id);
    setClientes(lista);
    return lista;
  }

  // Al abrir la app, si quedó una guía activa guardada en este celular (ver
  // src/lib/sesion.js), la retoma sola — el chofer no tiene que volver a tipear el
  // número de guía cada vez que sale y vuelve a entrar a mitad de reparto.
  React.useEffect(() => {
    const s = leerSesion();
    if (s) handleIniciar(s.chofer, s.guiaId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleIniciar(nombreChofer, guiaIdInput) {
    setLoading(true);
    setErrorMsg(null);
    try {
      const existente = await obtenerGuia(guiaIdInput);

      if (existente) {
        // Ya existe (por ejemplo el chofer cerró y volvió a abrir la app a mitad del
        // reparto) — NUNCA la pisamos con un manifiesto nuevo, eso borraría lo ya cargado.
        setGuia(existente);
        setGuiaId(guiaIdInput);
        setChoferNombre(existente.choferNombre || nombreChofer);
        const listaClientes = await refreshClientes(guiaIdInput);
        if (existente.estado === "cerrada") {
          const cheques = await listarChequesDeGuia(guiaIdInput);
          const transferencias = await listarTransferenciasDeGuia(guiaIdInput);
          const articulosDevueltos = await listarArticulosDevueltosDeGuia(guiaIdInput);
          setCierreData({
            totales: existente.totales,
            alertas: existente.alertas || [],
            cheques,
            transferencias,
            articulosDevueltos,
            clientes: listaClientes,
          });
          setScreen("cierreView");
          // Ya está cerrada — no queda reparto activo para retomar, así que no dejamos
          // la sesión guardada (si el chofer entra de nuevo, arranca del login normal).
          borrarSesion();
        } else {
          setScreen("lista");
          guardarSesion(existente.choferNombre || nombreChofer, guiaIdInput);
        }
      } else {
        // Único paso que necesita señal: bajar el manifiesto de BigQuery y crear la
        // guía en Firestore. De acá en más todo funciona con la copia local.
        const resp = await fetch(`/api/guia?guia_id=${encodeURIComponent(guiaIdInput)}`);
        if (!resp.ok) {
          const body = await resp.json().catch(() => ({}));
          throw new Error(body.error || `No se pudo traer la guía (${resp.status})`);
        }
        const manifiesto = await resp.json();
        await crearGuiaDesdeManifiesto(manifiesto, nombreChofer);
        const nueva = await obtenerGuia(guiaIdInput);
        setGuia(nueva);
        setGuiaId(guiaIdInput);
        setChoferNombre(nombreChofer);
        await refreshClientes(guiaIdInput);
        setScreen("lista");
        guardarSesion(nombreChofer, guiaIdInput);
      }
    } catch (err) {
      setErrorMsg(err.message || "Ocurrió un error al iniciar el reparto.");
    } finally {
      setLoading(false);
    }
  }

  function openDetalle(clienteId) {
    setSelectedClienteId(clienteId);
    setScreen("detalle");
  }

  // El chofer la usa para soltar la guía activa (por ejemplo si la tipeó mal, o si
  // terminó y quiere arrancar otra sin pasar por el cierre) y volver al login limpio.
  function handleNuevaGuia() {
    borrarSesion();
    setGuia(null);
    setGuiaId(null);
    setClientes([]);
    setCierreData(null);
    setChoferNombre("");
    setSelectedClienteId(null);
    setErrorMsg(null);
    setScreen("login");
  }

  async function backToLista() {
    const [guiaFresca] = await Promise.all([obtenerGuia(guiaId), refreshClientes(guiaId)]);
    if (guiaFresca) setGuia(guiaFresca);
    setScreen("lista");
  }

  async function handleCerrar() {
    setLoading(true);
    setErrorMsg(null);
    try {
      const { totales, alertas } = await cerrarGuia(guiaId);
      const cheques = await listarChequesDeGuia(guiaId);
      const transferencias = await listarTransferenciasDeGuia(guiaId);
      const articulosDevueltos = await listarArticulosDevueltosDeGuia(guiaId);
      const clientesFinal = await refreshClientes(guiaId);
      setCierreData({ totales, alertas, cheques, transferencias, articulosDevueltos, clientes: clientesFinal });
      setScreen("cierreView");
      // Terminó el reparto — no queda nada activo que retomar la próxima vez que entre.
      borrarSesion();
    } catch (err) {
      setErrorMsg(err.message || "No se pudo cerrar la guía.");
    } finally {
      setLoading(false);
    }
  }

  const selectedCliente = clientes.find((c) => c.clienteId === selectedClienteId) || null;

  return (
    <div className="app-root">
      {errorMsg && (
        <div className="app-error" role="alert">
          {errorMsg}
          <button type="button" onClick={() => setErrorMsg(null)} aria-label="Cerrar aviso">×</button>
        </div>
      )}

      {screen === "login" && (
        <Login onIniciar={handleIniciar} loading={loading} />
      )}

      {screen === "lista" && guia && (
        <ListaClientes
          guia={guia}
          clientes={clientes}
          choferNombre={choferNombre}
          onAbrirCliente={openDetalle}
          onCerrarGuia={handleCerrar}
          onNuevaGuia={handleNuevaGuia}
          loading={loading}
        />
      )}

      {screen === "detalle" && selectedCliente && (
        <DetalleCliente
          guiaId={guiaId}
          cliente={selectedCliente}
          onVolver={backToLista}
        />
      )}

      {screen === "cierreView" && guia && (
        <Cierre
          guia={guia}
          cierreData={cierreData}
          onVolver={() => setScreen("lista")}
        />
      )}
    </div>
  );
}

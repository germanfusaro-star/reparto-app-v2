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
} from "./data/guias";

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
          setCierreData({
            totales: existente.totales,
            alertas: existente.alertas || [],
            cheques,
            transferencias,
            clientes: listaClientes,
          });
          setScreen("cierreView");
        } else {
          setScreen("lista");
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
      const clientesFinal = await refreshClientes(guiaId);
      setCierreData({ totales, alertas, cheques, transferencias, clientes: clientesFinal });
      setScreen("cierreView");
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

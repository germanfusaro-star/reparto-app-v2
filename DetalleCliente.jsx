import React from "react";
import { fmt, fmtDecimal, toNumber } from "../utils/money";
import { compressImage } from "../utils/compressImage";
import { guardarEntregaCliente } from "../data/guias";
import { useToast } from "../hooks/useToast";
import { MOTIVOS_DEVOLUCION_LIST } from "../lib/motivosDevolucion";
import { describirCondicion, esperaCobroInmediato } from "../lib/condiciones";

const ESTADOS = [
  { k: "completo", label: "Completa" },
  { k: "parcial", label: "Parcial" },
  { k: "no_entregado", label: "No entregó" },
];

function round2(n) {
  return Math.round((n || 0) * 100) / 100;
}

export default function DetalleCliente({ guiaId, cliente, onVolver }) {
  const montoTotal = cliente.montoTotal || 0;

  const [estado, setEstado] = React.useState(
    cliente.estado === "pendiente" ? "completo" : cliente.estado
  );
  // V2: en vez de tipear un monto devuelto a mano, el chofer marca cantidad devuelta por
  // artículo — `comprobantes` es una copia de trabajo de cliente.comprobantes con
  // cantidadDevuelta editable por línea; el monto devuelto sale de sumar esas líneas (ver
  // `montoDevueltoArticulos` más abajo).
  const [comprobantes, setComprobantes] = React.useState(() =>
    (cliente.comprobantes || []).map((c) => ({
      ...c,
      items: (c.items || []).map((it) => ({ ...it, cantidadDevuelta: it.cantidadDevuelta || 0 })),
    }))
  );
  const [motivo, setMotivo] = React.useState(cliente.motivoDevolucion || "");
  const [payOn, setPayOn] = React.useState({
    efectivo: (cliente.pagos?.efectivo || 0) > 0,
    cheque: (cliente.chequesDetalle || []).length > 0,
    transferencia: (cliente.transferenciasDetalle || []).length > 0,
  });
  const [efectivo, setEfectivo] = React.useState(cliente.pagos?.efectivo || "");
  const [efectivoCargado, setEfectivoCargado] = React.useState(cliente.pagos?.efectivo || 0);
  const [chequeDraft, setChequeDraft] = React.useState((cliente.chequesDetalle || []).map((c) => ({ ...c })));
  const [chForm, setChForm] = React.useState({ numero: "", banco: "", fecha: "", monto: "" });
  const [chMontoCargado, setChMontoCargado] = React.useState(0);
  const [transferenciaDraft, setTransferenciaDraft] = React.useState(
    (cliente.transferenciasDetalle || []).map((t) => ({ ...t }))
  );
  const [transForm, setTransForm] = React.useState({ referencia: "", monto: "" });
  const [transMontoCargado, setTransMontoCargado] = React.useState(0);
  const [scan, setScan] = React.useState(null); // {status:'scanning'|'result'|'error', thumb, detected, referencia, error}
  const [saving, setSaving] = React.useState(false);
  const fileInputRef = React.useRef(null);
  const { showToast, toastNode } = useToast();

  // Precio neto por unidad de un artículo — el neto del ítem (ITEM_NETO, ya con cualquier
  // descuento aplicado) dividido la cantidad pedida, para poder valorizar cualquier
  // cantidad devuelta sin perder el descuento original.
  function precioNetoUnitario(item) {
    return item.cantidad > 0 ? item.neto / item.cantidad : 0;
  }

  // Monto devuelto = suma de (cantidad devuelta × precio neto unitario) de todos los
  // artículos marcados — reemplaza al monto que antes tipeaba el chofer a mano.
  const montoDevueltoArticulos = round2(
    comprobantes.reduce(
      (accComp, c) =>
        accComp + (c.items || []).reduce((accItem, it) => accItem + (it.cantidadDevuelta || 0) * precioNetoUnitario(it), 0),
      0
    )
  );

  const devuelto =
    estado === "parcial" ? Math.max(montoDevueltoArticulos, 0) : estado === "no_entregado" ? montoTotal : 0;
  const entregado = Math.max(round2(montoTotal - devuelto), 0);
  const chequeTotal = round2(chequeDraft.reduce((a, c) => a + (c.monto || 0), 0));
  const transferenciaTotal = round2(transferenciaDraft.reduce((a, t) => a + (t.monto || 0), 0));
  // Lo que se está por agregar (todavía no tocaron "+ Agregar" / "Agregar") también cuenta
  // para el neteo, una vez cargado — si no, al terminar de tipear un cheque o una
  // transferencia sin haberla confirmado todavía, "Falta cobrar" no la ve y da un salto
  // raro apenas se toca otro campo (por ejemplo si en el medio se borra el efectivo).
  const chequePendiente = payOn.cheque ? chMontoCargado : 0;
  const transferenciaPendiente = payOn.transferencia
    ? transMontoCargado + (scan?.status === "result" ? scan.detected || 0 : 0)
    : 0;
  const cobrado = round2(
    (payOn.efectivo ? efectivoCargado : 0) +
      (payOn.cheque ? chequeTotal + chequePendiente : 0) +
      (payOn.transferencia ? transferenciaTotal + transferenciaPendiente : 0)
  );
  const ctacte = Math.max(round2(entregado - cobrado), 0);
  const excedente = Math.max(round2(cobrado - entregado), 0);
  const faltaCobrar = ctacte; // saldo pendiente: se va achicando a medida que se imputan pagos
  const cobroDeshabilitado = estado === "no_entregado";
  const contado = esperaCobroInmediato(cliente.condicionPredeterminada);

  // Si el chofer marca "No entregó", vuelve el pedido entero — se marcan todas las
  // cantidades al máximo automáticamente, sin que tenga que tocar artículo por artículo.
  // Si vuelve a "Completa", se destildan todas (por si había marcado algo en "Parcial"
  // antes de corregir el estado).
  React.useEffect(() => {
    if (estado === "no_entregado") {
      setComprobantes((cs) =>
        cs.map((c) => ({ ...c, items: (c.items || []).map((it) => ({ ...it, cantidadDevuelta: it.cantidad || 0 })) }))
      );
    } else if (estado === "completo") {
      setComprobantes((cs) =>
        cs.map((c) => ({ ...c, items: (c.items || []).map((it) => ({ ...it, cantidadDevuelta: 0 })) }))
      );
    }
  }, [estado]);

  function cambiarCantidad(compNumero, itemIdx, delta) {
    setComprobantes((cs) =>
      cs.map((c) => {
        if (c.numero !== compNumero) return c;
        return {
          ...c,
          items: c.items.map((it, idx) => {
            if (idx !== itemIdx) return it;
            const max = it.cantidad || 0;
            const next = Math.min(max, Math.max(0, round2((it.cantidadDevuelta || 0) + delta)));
            return { ...it, cantidadDevuelta: next };
          }),
        };
      })
    );
  }

  function setCantidadDevuelta(compNumero, itemIdx, valorTexto) {
    setComprobantes((cs) =>
      cs.map((c) => {
        if (c.numero !== compNumero) return c;
        return {
          ...c,
          items: c.items.map((it, idx) => {
            if (idx !== itemIdx) return it;
            const max = it.cantidad || 0;
            const val = toNumber(valorTexto);
            return { ...it, cantidadDevuelta: Math.min(max, Math.max(0, val)) };
          }),
        };
      })
    );
  }

  function togglePago(medio) {
    setPayOn((p) => {
      const prendiendo = !p[medio];
      if (prendiendo) {
        // Al activar un medio de pago, precarga el saldo pendiente como valor por
        // defecto — la mayoría de las veces el chofer cobra todo en un solo medio, así
        // que le ahorra tipear el importe completo a mano; si combina medios, igual
        // puede corregir el número en vez de partir de cero.
        const pendiente = faltaCobrar > 0 ? String(faltaCobrar) : "";
        if (medio === "efectivo") {
          setEfectivo(pendiente);
          setEfectivoCargado(faltaCobrar);
        } else if (medio === "cheque") {
          setChForm((f) => ({ ...f, monto: pendiente }));
          setChMontoCargado(faltaCobrar);
        } else if (medio === "transferencia") {
          setTransForm((f) => ({ ...f, monto: pendiente }));
          setTransMontoCargado(faltaCobrar);
        }
      }
      return { ...p, [medio]: prendiendo };
    });
  }

  function agregarCheque() {
    const monto = toNumber(chForm.monto);
    if (monto <= 0) {
      showToast("Cargá el monto del cheque.");
      return;
    }
    setChequeDraft((list) => [
      ...list,
      { numero: chForm.numero.trim(), banco: chForm.banco.trim(), fecha: chForm.fecha, monto },
    ]);
    setChForm({ numero: "", banco: "", fecha: "", monto: "" });
    setChMontoCargado(0);
    setPayOn((p) => ({ ...p, cheque: true }));
  }

  function quitarCheque(idx) {
    setChequeDraft((list) => list.filter((_, i) => i !== idx));
  }

  function agregarTransferencia() {
    const monto = toNumber(transForm.monto);
    if (monto <= 0) {
      showToast("Cargá el monto de la transferencia.");
      return;
    }
    setTransferenciaDraft((list) => [...list, { referencia: transForm.referencia.trim(), monto }]);
    setTransForm({ referencia: "", monto: "" });
    setTransMontoCargado(0);
    setPayOn((p) => ({ ...p, transferencia: true }));
  }

  function quitarTransferencia(idx) {
    setTransferenciaDraft((list) => list.filter((_, i) => i !== idx));
  }

  function abrirCamara() {
    fileInputRef.current?.click();
  }

  async function onArchivoSeleccionado(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const isPdf = file.type === "application/pdf";
    try {
      const dataUrl = await compressImage(file);
      setScan({ status: "scanning", thumb: dataUrl, isPdf });
      const resp = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: dataUrl }),
      });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(body.error || "No se pudo leer el comprobante.");
      if (body.monto == null) {
        setScan({ status: "error", thumb: dataUrl, isPdf, error: "No se pudo leer el monto con certeza — cargalo a mano." });
        return;
      }
      setScan({ status: "result", thumb: dataUrl, isPdf, detected: body.monto, referencia: body.referencia || "" });
    } catch (err) {
      setScan({ status: "error", thumb: null, isPdf, error: err.message || "Error leyendo el comprobante." });
    }
  }

  function confirmarScan() {
    if (!scan || scan.detected == null) return;
    setTransferenciaDraft((list) => [...list, { referencia: scan.referencia || "", monto: scan.detected }]);
    setPayOn((p) => ({ ...p, transferencia: true }));
    setScan(null);
    showToast("Transferencia agregada.");
  }

  function corregirScan() {
    if (!scan) return;
    setTransForm({ referencia: scan.referencia || "", monto: String(scan.detected ?? "") });
    setTransMontoCargado(scan.detected || 0);
    setScan(null);
  }

  async function handleGuardar() {
    setSaving(true);
    try {
      const datos = {
        estado,
        montoDevuelto: devuelto,
        comprobantes,
        motivoDevolucion: motivo,
        efectivo: payOn.efectivo ? toNumber(efectivo) : 0,
        chequesDetalle: payOn.cheque ? chequeDraft : [],
        transferenciasDetalle: payOn.transferencia ? transferenciaDraft : [],
      };
      await guardarEntregaCliente(guiaId, cliente.clienteId, cliente, datos);
      showToast("Guardado — se sincroniza automáticamente cuando haya señal.");
      onVolver();
    } catch (err) {
      showToast(err.message || "No se pudo guardar. Reintentá.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="screen">
      <div className="app-bar">
        <button className="back" type="button" aria-label="Volver" onClick={onVolver}>
          ←
        </button>
        <div className="titles">
          <h2>{cliente.nombre}</h2>
          <span className="sub">{cliente.direccion}</span>
        </div>
      </div>

      <div className="scroll">
        <div className="card detail-block">
          <h4>Comprobantes</h4>
          <span className={`cond-chip ${contado ? "contado" : "ctacte"}`}>
            {describirCondicion(cliente.condicionPredeterminada)}
          </span>
          <div>
            {(cliente.comprobantes || []).map((c) => (
              <div className="comp-row" key={c.numero}>
                <span className="num">
                  Nº {c.numero}
                  <br />
                  <span className="cond">{c.condicion_venta_desc || c.condicion_venta}</span>
                </span>
                <span className="m">{fmt(c.monto)}</span>
              </div>
            ))}
          </div>
          <div className="total-line">
            <span>Total a entregar</span>
            <span className="m">{fmt(montoTotal)}</span>
          </div>
        </div>

        <div className="card detail-block">
          <h4>Entrega</h4>
          <div className="radio-group">
            {ESTADOS.map((e) => (
              <div
                key={e.k}
                className={`radio-card${estado === e.k ? " sel" : ""}`}
                data-k={e.k}
                role="button"
                tabIndex={0}
                onClick={() => setEstado(e.k)}
                onKeyDown={(ev) => (ev.key === "Enter" || ev.key === " ") && setEstado(e.k)}
              >
                {e.label}
              </div>
            ))}
          </div>
          {(estado === "parcial" || estado === "no_entregado") && (
            <div className="field" style={{ marginTop: 10 }}>
              <label>Artículos devueltos</label>
              <div className="articulos-list">
                {comprobantes.flatMap((c) =>
                  (c.items || []).map((it, idx) => {
                    const marcado = (it.cantidadDevuelta || 0) > 0;
                    return (
                      <div className={`articulo-row${marcado ? " devuelto" : ""}`} key={`${c.numero}-${idx}`}>
                        <div className="ar-main">
                          <span className="ar-desc">{it.descripcion}</span>
                          <span className="ar-sub">
                            {it.codigo && <>Cód. {it.codigo} · </>}
                            Pedido: {it.cantidad} · N° {c.numero}
                            {marcado && (
                              <>
                                {" "}
                                · <span className="ar-monto">−{fmt((it.cantidadDevuelta || 0) * precioNetoUnitario(it))}</span>
                              </>
                            )}
                          </span>
                        </div>
                        <div className="ar-stepper">
                          <button
                            type="button"
                            disabled={estado === "no_entregado" || (it.cantidadDevuelta || 0) <= 0}
                            onClick={() => cambiarCantidad(c.numero, idx, -1)}
                            aria-label="Restar unidad devuelta"
                          >
                            −
                          </button>
                          <input
                            inputMode="decimal"
                            value={it.cantidadDevuelta}
                            disabled={estado === "no_entregado"}
                            onChange={(e) => setCantidadDevuelta(c.numero, idx, e.target.value)}
                          />
                          <button
                            type="button"
                            disabled={estado === "no_entregado" || (it.cantidadDevuelta || 0) >= (it.cantidad || 0)}
                            onClick={() => cambiarCantidad(c.numero, idx, 1)}
                            aria-label="Sumar unidad devuelta"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              <div className="articulos-total-line">
                <span>Total devuelto</span>
                <b>{fmt(devuelto)}</b>
              </div>
              {estado === "no_entregado" && (
                <span className="articulos-note">Se devuelve todo el pedido — no hace falta marcar artículo por artículo.</span>
              )}
            </div>
          )}
          {estado === "parcial" && (
            <div className="entrega-neta-line">
              <span>Entrega neta (descontada la devolución)</span>
              <b>{fmt(entregado)}</b>
            </div>
          )}
          {estado === "no_entregado" && (
            <div className="entrega-neta-line">
              <span>Devuelto todo el pedido</span>
              <b>{fmt(0)}</b>
            </div>
          )}
          {(estado === "parcial" || estado === "no_entregado") && (
            <div className="field" style={{ marginTop: 10 }}>
              <label htmlFor="motivo">Motivo</label>
              <select id="motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)}>
                <option value="">Seleccionar motivo…</option>
                {MOTIVOS_DEVOLUCION_LIST.map((m) => (
                  <option key={m.codigo} value={m.codigo}>
                    {m.nombre}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="card detail-block" style={{ opacity: cobroDeshabilitado ? 0.45 : 1, pointerEvents: cobroDeshabilitado ? "none" : "auto" }}>
          <h4>Cobro (podés combinar medios)</h4>
          <div className={`saldo-pendiente-card${faltaCobrar === 0 && entregado > 0 ? " ok" : ""}`}>
            <span className="lbl">{faltaCobrar === 0 && entregado > 0 ? "Cobrado por completo" : "Falta cobrar"}</span>
            <span className="val">{fmt(faltaCobrar)}</span>
            <span className="sub">
              {cobrado > 0 ? `Cobrado ${fmt(cobrado)} de ${fmt(entregado)}` : `Total a cobrar: ${fmt(entregado)}`}
            </span>
          </div>

          <div className="pay-chip-row">
            <div className={`pay-chip${payOn.efectivo ? " on" : ""}`} onClick={() => togglePago("efectivo")}>
              💵<span>Efectivo</span>
            </div>
            <div className={`pay-chip${payOn.cheque ? " on" : ""}`} onClick={() => togglePago("cheque")}>
              🧾<span>Cheque</span>
            </div>
            <div className={`pay-chip${payOn.transferencia ? " on" : ""}`} onClick={() => togglePago("transferencia")}>
              📲<span>Transf.</span>
            </div>
          </div>

          <div className="pay-amounts" style={{ marginTop: 10 }}>
            <div className={`pay-amount-row${payOn.efectivo ? " on" : ""}`}>
              <label>Efectivo</label>
              <input
                inputMode="decimal"
                value={efectivo}
                onChange={(e) => setEfectivo(e.target.value)}
                onBlur={() => setEfectivoCargado(toNumber(efectivo))}
              />
            </div>

            <div className={`pay-amount-row${payOn.cheque ? " on" : ""}`}>
              <div className="cheque-manager">
                <div className="cheque-list">
                  {chequeDraft.map((ch, idx) => (
                    <div className="cheque-item" key={idx}>
                      <div className="ci-main">
                        <span className="ci-num">N° {ch.numero || "s/n"}</span>
                        <span className="ci-sub">{ch.banco || "Banco s/d"} · {ch.fecha || "s/f"}</span>
                      </div>
                      <span className="ci-amt">{fmt(ch.monto)}</span>
                      <button type="button" className="ci-rm" aria-label="Quitar cheque" onClick={() => quitarCheque(idx)}>
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <div className="cheque-form">
                  <div className="cheque-form-grid">
                    <input
                      type="text"
                      placeholder="N° de cheque"
                      value={chForm.numero}
                      onChange={(e) => setChForm((f) => ({ ...f, numero: e.target.value }))}
                    />
                    <input
                      type="text"
                      placeholder="Banco"
                      value={chForm.banco}
                      onChange={(e) => setChForm((f) => ({ ...f, banco: e.target.value }))}
                    />
                  </div>
                  <div className="cheque-form-grid">
                    <input
                      type="date"
                      value={chForm.fecha}
                      onChange={(e) => setChForm((f) => ({ ...f, fecha: e.target.value }))}
                    />
                    <input
                      inputMode="decimal"
                      placeholder="Monto"
                      value={chForm.monto}
                      onChange={(e) => setChForm((f) => ({ ...f, monto: e.target.value }))}
                      onBlur={() => setChMontoCargado(toNumber(chForm.monto))}
                    />
                  </div>
                  <button className="btn btn-ghost btn-block" type="button" onClick={agregarCheque}>
                    + Agregar cheque
                  </button>
                </div>
                <div className="cheque-total-line">
                  <span>Total cheques</span>
                  <b>{fmt(chequeTotal)}</b>
                </div>
              </div>
            </div>

            <div className={`pay-amount-row${payOn.transferencia ? " on" : ""}`}>
              <div className="transfer-manager">
                <div className="cheque-list">
                  {transferenciaDraft.map((t, idx) => (
                    <div className="cheque-item" key={idx}>
                      <div className="ci-main">
                        <span className="ci-num">{t.referencia || "Sin referencia"}</span>
                      </div>
                      <span className="ci-amt">{fmt(t.monto)}</span>
                      <button type="button" className="ci-rm" aria-label="Quitar transferencia" onClick={() => quitarTransferencia(idx)}>
                        ×
                      </button>
                    </div>
                  ))}
                </div>

                <div className="transfer-scan-row">
                  <button type="button" className="btn btn-ghost" onClick={abrirCamara}>
                    📷 Foto, galería o PDF
                  </button>
                </div>

                {scan && (
                  <div className="scan-result">
                    <div className="sr-row">
                      {scan.thumb && !scan.isPdf && <img className="sr-thumb" src={scan.thumb} alt="Comprobante escaneado" />}
                      {scan.thumb && scan.isPdf && (
                        <span className="sr-thumb sr-thumb-pdf" aria-hidden="true">
                          PDF
                        </span>
                      )}
                      {scan.status === "scanning" && (
                        <span className="sr-status">
                          <span className="scan-spinner" /> Leyendo comprobante…
                        </span>
                      )}
                      {scan.status === "result" && (
                        <div className="scan-detected">
                          <span className="sd-lbl">Monto detectado</span>
                          <span className="sd-val">{fmtDecimal(scan.detected)}</span>
                          {scan.referencia && <span className="scan-note">{scan.referencia}</span>}
                        </div>
                      )}
                      {scan.status === "error" && <span className="scan-error">{scan.error}</span>}
                    </div>
                    {scan.status === "result" && (
                      <>
                        <div className="scan-actions">
                          <button type="button" className="btn btn-primary" onClick={confirmarScan}>
                            ✓ Agregar
                          </button>
                          <button type="button" className="btn btn-ghost" onClick={corregirScan}>
                            ✎ Corregir
                          </button>
                        </div>
                        <span className="scan-note">Confirmá el monto o corregilo antes de agregarlo.</span>
                      </>
                    )}
                    {scan.status === "error" && (
                      <button type="button" className="btn btn-ghost btn-block" onClick={() => setScan(null)}>
                        Cerrar
                      </button>
                    )}
                  </div>
                )}

                <div className="cheque-form">
                  <div className="cheque-form-grid">
                    <input
                      type="text"
                      placeholder="Referencia (banco, CBU, alias...)"
                      value={transForm.referencia}
                      onChange={(e) => setTransForm((f) => ({ ...f, referencia: e.target.value }))}
                    />
                    <input
                      inputMode="decimal"
                      placeholder="Monto"
                      value={transForm.monto}
                      onChange={(e) => setTransForm((f) => ({ ...f, monto: e.target.value }))}
                      onBlur={() => setTransMontoCargado(toNumber(transForm.monto))}
                    />
                  </div>
                  <button className="btn btn-ghost btn-block" type="button" onClick={agregarTransferencia}>
                    + Agregar transferencia
                  </button>
                </div>
                <div className="cheque-total-line">
                  <span>Total transferencias</span>
                  <b>{fmt(transferenciaTotal)}</b>
                </div>

                {/* Sin "capture": así el celular ofrece elegir entre sacar una foto,
                    buscar en la galería (por ejemplo una foto que le reenviaron por
                    WhatsApp) o abrir un archivo — y acepta PDF además de imágenes. */}
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  ref={fileInputRef}
                  style={{ display: "none" }}
                  onChange={onArchivoSeleccionado}
                />
              </div>
            </div>
          </div>

          {excedente > 0 && (
            <div className="ctacte-note">Cobraste {fmt(excedente)} de más — revisá los montos.</div>
          )}
        </div>
      </div>

      <div className="footer-actions">
        <button className="btn btn-primary btn-block" type="button" disabled={saving} onClick={handleGuardar}>
          {saving ? "Guardando…" : "Guardar y siguiente"}
        </button>
      </div>
      {toastNode}
    </div>
  );
}

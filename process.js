// Vercel Serverless Function
// POST /api/process  { image: "data:image/jpeg;base64,..." | "data:application/pdf;base64,..." }
// -> { monto, fecha, origen, destino, referencia, bancoOrigen, bancoDestino, cbuDestino }
//
// Lee un comprobante de transferencia con IA (Anthropic, claude-sonnet-4-6) y devuelve los
// datos detectados para que el chofer los confirme antes de agregarlos — nunca se cargan
// solos, siempre pasa por la validación del chofer. Trae los mismos campos que CobrApp
// (a pedido de Germán el 2026-09-15, para que el reporte de transferencias de las dos apps
// tenga la misma información y se pueda conciliar igual): monto, fecha, origen (nombre de
// quien envía), destino (nombre de quien recibe), referencia/N° de operación, banco de
// origen, banco de destino y CBU de destino. El monto es el único campo obligatorio — si
// no se lee con certeza, se descarta todo el resultado (los demás campos pueden venir
// vacíos sin problema, el chofer los completa a mano si hace falta).
//
// El comprobante puede venir como foto/imagen (sacada con la cámara o elegida de la
// galería) o como PDF (por ejemplo si al chofer se lo reenviaron por WhatsApp) — el campo
// se sigue llamando "image" por compatibilidad, pero acepta cualquiera de los dos.
//
// Requiere la variable de entorno ANTHROPIC_API_KEY en Vercel (Settings > Environment
// Variables). Se puede generar/gestionar en console.anthropic.com > Settings > API Keys.

const Anthropic = require("@anthropic-ai/sdk");

const MODEL = "claude-sonnet-4-6";

// Normaliza lo que devuelve el modelo ("$ 43.218,69", "43218.69", etc.) a un número.
function cleanMonto(texto) {
  if (texto == null) return null;
  let s = String(texto).trim();
  s = s.replace(/[^\d.,-]/g, "");
  if (!s) return null;
  // Formato AR: "43.218,69" -> punto de miles, coma decimal.
  const tieneComaDecimal = /,\d{1,2}$/.test(s);
  if (tieneComaDecimal) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    s = s.replace(/,/g, "");
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

// Deja un string vacío o null como null (nunca "" ni "s/d" ni "no aparece") — así el
// frontend sabe que ese campo no se pudo leer y no lo confunde con un valor real.
function limpiarTexto(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || /^(null|n\/a|s\/d|no aparece|no figura|desconocido)$/i.test(s)) return null;
  return s;
}

// El modelo tiene que responder solo JSON, pero por las dudas viene envuelto en texto o en
// un bloque de código, se busca el primer objeto { ... } dentro de la respuesta.
function parseRespuesta(textoDetectado) {
  try {
    const jsonMatch = textoDetectado.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : textoDetectado);
    return {
      montoTexto: parsed.monto,
      fecha: limpiarTexto(parsed.fecha),
      origen: limpiarTexto(parsed.origen),
      destino: limpiarTexto(parsed.destino),
      referencia: limpiarTexto(parsed.referencia),
      bancoOrigen: limpiarTexto(parsed.bancoOrigen),
      bancoDestino: limpiarTexto(parsed.bancoDestino),
      cbuDestino: limpiarTexto(parsed.cbuDestino),
    };
  } catch {
    // No vino un JSON válido — probamos igual sacar el monto del texto crudo, así no se
    // pierde una lectura que sí vino bien pero mal formateada. El resto de los campos
    // quedan vacíos, el chofer los completa a mano si hace falta.
    return {
      montoTexto: textoDetectado,
      fecha: null,
      origen: null,
      destino: null,
      referencia: null,
      bancoOrigen: null,
      bancoDestino: null,
      cbuDestino: null,
    };
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método no permitido" });
    return;
  }

  const { image } = req.body || {};
  if (!image || typeof image !== "string") {
    res.status(400).json({ error: "Falta el comprobante (image, como data URL base64)" });
    return;
  }

  const match = image.match(/^data:([\w.+-]+\/[\w.+-]+);base64,(.+)$/);
  if (!match) {
    res.status(400).json({ error: "El comprobante no tiene un formato data URL válido" });
    return;
  }
  const [, mediaType, base64Data] = match;
  const esPdf = mediaType === "application/pdf";
  if (!esPdf && !mediaType.startsWith("image/")) {
    res.status(400).json({ error: "Formato no soportado — solo se acepta imagen o PDF" });
    return;
  }

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const comprobanteBlock = esPdf
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64Data } }
      : { type: "image", source: { type: "base64", media_type: mediaType, data: base64Data } };

    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: [
            comprobanteBlock,
            {
              type: "text",
              text:
                "Esto es un comprobante de transferencia bancaria argentino (puede ser una foto o un " +
                "PDF). Extraé del comprobante estos datos, cuando aparezcan: monto transferido en " +
                "pesos; fecha de la operación (como figure, ej. \"14/09/2026\"); nombre de la persona o " +
                "empresa que ENVÍA la transferencia (origen/remitente); nombre de quien la RECIBE " +
                "(destino/destinatario); banco o billetera emisora (banco de origen); banco o billetera " +
                "receptora (banco de destino); CBU o alias de destino; y el número de operación o " +
                "referencia. Si un dato no aparece en el comprobante, usá null para ese campo — no " +
                "inventes ni completes con texto genérico. Respondé SOLO un JSON válido, sin texto " +
                "adicional ni bloque de código, con este formato exacto: " +
                '{"monto":"43218.69","fecha":"14/09/2026","origen":"Juan Pérez","destino":"SAN LORENZO ' +
                'STAR SRL","bancoOrigen":"Banco Galicia","bancoDestino":"Banco Santander","cbuDestino":' +
                '"0720043988000012345678","referencia":"Op 123456789"}. Si no podés leer el monto con ' +
                'certeza, respondé exactamente {"monto":null,"fecha":null,"origen":null,"destino":null,' +
                '"bancoOrigen":null,"bancoDestino":null,"cbuDestino":null,"referencia":null}.',
            },
          ],
        },
      ],
    });

    const textoDetectado = message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join(" ")
      .trim();

    if (!textoDetectado) {
      res.status(200).json({
        monto: null,
        fecha: null,
        origen: null,
        destino: null,
        referencia: null,
        bancoOrigen: null,
        bancoDestino: null,
        cbuDestino: null,
      });
      return;
    }

    const datos = parseRespuesta(textoDetectado);
    const monto = cleanMonto(datos.montoTexto);
    // Si no se pudo leer el monto con certeza, se descarta todo — sin monto no sirve de
    // nada tener el resto de los datos, y el chofer lo carga a mano.
    res.status(200).json({
      monto,
      fecha: monto == null ? null : datos.fecha,
      origen: monto == null ? null : datos.origen,
      destino: monto == null ? null : datos.destino,
      referencia: monto == null ? null : datos.referencia,
      bancoOrigen: monto == null ? null : datos.bancoOrigen,
      bancoDestino: monto == null ? null : datos.bancoDestino,
      cbuDestino: monto == null ? null : datos.cbuDestino,
    });
  } catch (err) {
    console.error("Error llamando a Anthropic:", err);
    res.status(500).json({ error: "Error leyendo el comprobante", detalle: err.message });
  }
};

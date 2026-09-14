// Vercel Serverless Function
// POST /api/process  { image: "data:image/jpeg;base64,..." | "data:application/pdf;base64,..." }
// -> { monto: number|null, referencia: string|null }
//
// Lee un comprobante de transferencia con IA (Anthropic, claude-sonnet-4-6) y devuelve el
// monto detectado para que el chofer lo confirme o lo corrija en la app — nunca se carga
// solo, siempre pasa por la validación del chofer. También devuelve una referencia corta
// (banco/billetera, CBU o alias, número de operación) para identificar la transferencia
// más adelante, igual que hace CobrApp con sus comprobantes.
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

// El modelo tiene que responder solo JSON, pero por las dudas viene envuelto en texto o en
// un bloque de código, se busca el primer objeto { ... } dentro de la respuesta.
function parseRespuesta(textoDetectado) {
  try {
    const jsonMatch = textoDetectado.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : textoDetectado);
    return { montoTexto: parsed.monto, referencia: parsed.referencia || null };
  } catch {
    // No vino un JSON válido — probamos igual sacar el monto del texto crudo, así no se
    // pierde una lectura que sí vino bien pero mal formateada.
    return { montoTexto: textoDetectado, referencia: null };
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
                "PDF). Extraé del comprobante: (1) el monto transferido, en pesos, y (2) una referencia " +
                "corta que ayude a identificar la transferencia más adelante — banco o billetera emisora, " +
                "CBU o alias, y número de operación, lo que aparezca, en una sola línea corta. Respondé " +
                "SOLO un JSON válido, sin texto adicional ni bloque de código, con este formato exacto: " +
                '{"monto":"43218.69","referencia":"Banco Galicia · Op 123456789"}. Si no podés leer el ' +
                'monto con certeza, respondé exactamente {"monto":null,"referencia":null}.',
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
      res.status(200).json({ monto: null, referencia: null });
      return;
    }

    const { montoTexto, referencia } = parseRespuesta(textoDetectado);
    const monto = cleanMonto(montoTexto);
    res.status(200).json({ monto, referencia: monto == null ? null : referencia });
  } catch (err) {
    console.error("Error llamando a Anthropic:", err);
    res.status(500).json({ error: "Error leyendo el comprobante", detalle: err.message });
  }
};

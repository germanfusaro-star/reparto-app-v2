// Comprime una foto (File/Blob) del lado del cliente antes de mandarla al backend —
// Vercel tiene un límite de payload de 4.5MB en sus funciones serverless, y el base64
// infla el tamaño ~33% más, así que hay que llegar bien por debajo de eso. Mismo
// aprendizaje que ya se aplicó en CobrApp.
//
// El comprobante de transferencia puede llegar como foto (sacada con la cámara o elegida
// de la galería) o como PDF (por ejemplo si al chofer se lo reenviaron por WhatsApp) — un
// PDF no se puede "comprimir" con canvas como una imagen, así que en ese caso lo mandamos
// tal cual, solo convertido a data URL.
//
// Las cámaras de los celulares actuales sacan fotos enormes (48, 50, 108 megapíxeles...).
// Decodificarlas ENTERAS en memoria antes de achicarlas (como hacía la versión anterior,
// con `new Image()` leyendo un data URL) puede tirar "memoria insuficiente" y reiniciar la
// app en celulares más limitados — es lo que le pasó a Germán al sacar una foto con la
// cámara. Por eso ahora se usa `createImageBitmap` con las opciones de resize: en los
// navegadores que las soportan, el achicado pasa a formar parte de la propia decodificación
// (nunca se llega a alojar en memoria la foto original completa). Si el navegador no las
// soporta, se cae al método anterior (más pesado en memoria, pero sigue funcionando).
export async function compressImage(file, { maxDim = 1600, quality = 0.72 } = {}) {
  if (!file.type || !file.type.startsWith("image/")) {
    // No es una imagen (típicamente un PDF): no hay nada para redimensionar,
    // se manda el archivo tal cual como data URL.
    return readAsDataUrl(file);
  }

  if (window.createImageBitmap) {
    try {
      return await compressViaImageBitmap(file, maxDim, quality);
    } catch {
      // Algún navegador/cámara no soportó el resize directo (o el formato de la foto) —
      // seguimos con el método clásico en vez de dejar la app colgada.
    }
  }
  return compressViaImageElement(file, maxDim, quality);
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

async function compressViaImageBitmap(file, maxDim, quality) {
  const bitmap = await createImageBitmap(file, {
    resizeWidth: maxDim,
    resizeQuality: "medium",
    imageOrientation: "from-image",
  });
  try {
    // Por si el navegador ignoró resizeWidth (algunos lo hacen), volvemos a capar acá
    // antes de crear el canvas final — nunca creamos un canvas a tamaño completo.
    let { width, height } = bitmap;
    if (width > maxDim || height > maxDim) {
      const scale = maxDim / Math.max(width, height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    bitmap.close?.();
  }
}

function compressViaImageElement(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    // Object URL en vez de data URL: evita tener en memoria, al mismo tiempo, el archivo
    // original y una copia en texto base64 ~33% más pesada solo para poder mostrarla.
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.src = url;
  });
}

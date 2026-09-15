// Recuerda, en este celular, qué guía y qué chofer quedaron activos — así si el chofer
// sale de la app (o el celular la mata en segundo plano) y vuelve a entrar, la app
// retoma solo la guía en curso en vez de pedirle que tipee el número de nuevo.
// Se borra sola cuando el chofer cierra/rinde la guía (ver handleCerrar en App.jsx) o
// cuando toca "Cambiar de guía".

const KEY = "repartoapp_sesion";

export function guardarSesion(chofer, guiaId) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ chofer, guiaId }));
  } catch {
    // localStorage puede fallar (modo privado, cuota llena) — no es crítico, en ese caso
    // el chofer simplemente vuelve a tipear la guía la próxima vez que entre.
  }
}

export function leerSesion() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || !s.chofer || !s.guiaId) return null;
    return s;
  } catch {
    return null;
  }
}

export function borrarSesion() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ver guardarSesion
  }
}

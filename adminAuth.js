// Autenticación del panel de administración: usuario y contraseña reales (Firebase Auth
// Email/Password), a diferencia de la sesión anónima que usa la app del chofer.
// Cada persona de oficina tiene su propio usuario — se crean a mano desde la consola de
// Firebase (Authentication > Users > Add user), no hay alta pública para evitar que
// cualquiera con la URL se cree una cuenta. Ver ADMIN_SETUP.md.
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "firebase/auth";
import auth from "../auth";

/** true si hay una sesión real de admin activa (no la anónima del chofer). */
export function esUsuarioAdmin(user) {
  return !!user && !user.isAnonymous;
}

export function iniciarSesionAdmin(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export function cerrarSesionAdmin() {
  return signOut(auth);
}

/** Se dispara cada vez que cambia el estado de auth; el callback recibe el user o null. */
export function suscribirseAAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

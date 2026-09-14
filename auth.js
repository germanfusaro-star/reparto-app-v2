import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";
import app from "./firebase";

const auth = getAuth(app);

/**
 * Asegura que haya una sesión anónima de Firebase antes de usar Firestore — las
 * reglas de seguridad (firestore.rules) exigen request.auth != null. Hay que activar
 * "Anonymous" en Firebase Console > Authentication > Sign-in method para que esto
 * funcione. Se llama una vez al arrancar la app (por ejemplo en main.jsx), antes de
 * cualquier lectura/escritura a Firestore.
 */
export function ensureAnonAuth() {
  return new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        unsubscribe();
        if (user) {
          resolve(user);
        } else {
          signInAnonymously(auth).then((cred) => resolve(cred.user)).catch(reject);
        }
      },
      reject
    );
  });
}

export default auth;

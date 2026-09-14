import { initializeApp } from "firebase/app";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";

// Config real del proyecto Firebase (reparto-app-slstar).
// Firebase Console > Configuración del proyecto > Tus apps > SDK setup and configuration.
const firebaseConfig = {
  apiKey: "AIzaSyBH615KHCxHkxelCX5DEIDxAWgZ3OtSpww",
  authDomain: "reparto-app-slstar.firebaseapp.com",
  projectId: "reparto-app-slstar",
  storageBucket: "reparto-app-slstar.firebasestorage.app",
  messagingSenderId: "1091452140676",
  appId: "1:1091452140676:web:557fbc94723dd370f716d1",
};

const app = initializeApp(firebaseConfig);

// Persistencia offline: el chofer puede seguir leyendo y escribiendo aunque se quede
// sin señal en el recorrido — Firestore guarda todo localmente en el celular y
// sincroniza solo cuando vuelve la conexión, sin que la app tenga que manejar eso a mano.
// persistentMultipleTabManager evita conflictos si en algún momento la app queda abierta
// en más de una pestaña/ventana del mismo dispositivo.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

export default app;

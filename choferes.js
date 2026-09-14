// Lista de choferes que aparece en el desplegable de login de la app — antes venía
// hardcodeada en src/screens/Login.jsx con nombres de ejemplo; ahora vive en Firestore
// para que se pueda dar de alta/baja un chofer desde el panel de administración (/admin),
// sin depender de un cambio de código + redeploy cada vez que cambia la plantilla.
import { collection, getDocs, addDoc, deleteDoc, doc, query, orderBy } from "firebase/firestore";
import { db } from "../firebase";

const choferesCol = collection(db, "choferes");

/** Choferes ordenados por nombre — los lee tanto el login del chofer como el admin. */
export async function listarChoferes() {
  const q = query(choferesCol, orderBy("nombre"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Alta de un chofer nuevo. Firestore lo deja escribir solo a una sesión NO anónima (ver
 * firestore.rules) — es decir, solo desde el panel de admin, nunca desde la app del chofer.
 */
export async function agregarChofer(nombre) {
  const limpio = (nombre || "").trim();
  if (!limpio) throw new Error("El nombre no puede estar vacío.");
  await addDoc(choferesCol, { nombre: limpio });
}

/** Baja de un chofer — mismo control de acceso que agregarChofer(). */
export async function eliminarChofer(choferId) {
  await deleteDoc(doc(db, "choferes", choferId));
}

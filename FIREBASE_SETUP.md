# Setup de Firebase (una sola vez)

1. Andá a [console.firebase.google.com](https://console.firebase.google.com) y creá un proyecto nuevo (sugerido: `reparto-app-slstar`, pero cualquier nombre sirve).
2. Dentro del proyecto: **Build > Firestore Database > Crear base de datos** — modo producción, ubicación `southamerica-east1` (San Pablo, la más cercana) o `us-central` si preferís.
3. **Build > Authentication > Sign-in method** — activá el proveedor **Anonymous**. No hace falta nada más acá: el chofer no inicia sesión con usuario/contraseña, la app abre una sesión anónima sola apenas arranca, solo para que las reglas de seguridad puedan distinguir "viene de la app" de "cualquiera con la URL".
4. **Configuración del proyecto (ícono de engranaje) > Tus apps > Agregar app > Web** — le ponés un nombre (ej. "RepartoApp web") y Firebase te muestra un bloque `firebaseConfig = {...}`. Ese bloque completo va pegado en `src/firebase.js`, reemplazando los valores `"TU_..."`.
5. Instalar la CLI de Firebase si no la tenés (`npm install -g firebase-tools`), y desde la carpeta del proyecto:
   ```
   firebase login
   firebase init firestore   (elegís el proyecto que creaste en el paso 1; cuando pregunte por las reglas, apuntá al firestore.rules que ya está en este repo)
   firebase deploy --only firestore:rules
   ```
   Eso sube las reglas de `firestore.rules` (que exigen sesión anónima para leer/escribir) a tu proyecto real.

Con esos 5 pasos la app ya puede leer y escribir en Firestore. El resto (variables de entorno de BigQuery en Vercel, dominio, etc.) lo documentamos aparte cuando esté lista para desplegarse.

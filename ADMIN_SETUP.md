# Panel de administración — cómo crear usuarios

El panel de rendiciones vive en la misma app, en la ruta `/admin` (por ejemplo
`https://reparto-app-nine.vercel.app/admin`). Es de solo lectura: muestra guías,
totales e incidencias, pero no permite cargar ni modificar entregas — eso lo sigue
haciendo el chofer desde la app.

A diferencia de la app del chofer (que abre sola una sesión anónima), acá cada persona
de oficina entra con **usuario y contraseña reales**. No hay alta pública — los usuarios
se crean a mano, uno por uno, desde la consola de Firebase:

1. Andá a [console.firebase.google.com](https://console.firebase.google.com) → proyecto
   `reparto-app-slstar` → **Seguridad → Authentication → Usuarios (Users)**.
2. **Agregar usuario (Add user)**.
3. Cargá el email y una contraseña para esa persona → **Agregar usuario**.
4. Repetí por cada persona que necesite entrar al panel.

Con eso ya puede entrar a `/admin` con ese email y esa contraseña. Para sacarle el
acceso a alguien, se borra su usuario desde esa misma pantalla.

## Lista de choferes

El desplegable de "Chofer" que ve el repartidor al iniciar la app ya no tiene nombres de
ejemplo cargados a mano en el código — se administra desde `/admin → Choferes`: ahí se
puede agregar o sacar choferes en cualquier momento, sin necesitar un cambio de código ni
un redeploy. Se guarda en la colección `choferes` de Firestore.

Nota técnica: las reglas de Firestore (`firestore.rules`) dan acceso de lectura a
cualquier sesión autenticada, sea anónima (chofer) o real (admin) — no hay una regla
aparte que distinga "admin" de "chofer" a nivel de base de datos todavía, **excepto** en
la colección `choferes`: ahí la escritura (agregar/sacar chofer) está restringida a
sesiones no anónimas, así el panel de admin es el único que puede modificar esa lista. Si
más adelante hace falta una separación más estricta en el resto de la base (por ejemplo,
que el chofer no pueda leer guías de otros choferes), se puede sumar sin romper lo que ya
funciona.

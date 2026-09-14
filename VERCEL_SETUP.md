# Setup de Vercel (despliegue + variables de entorno)

Esto es para cuando ya revisaste la app y querés que quede corriendo de verdad en un
link (no antes — hasta ese momento todo se prueba local o mandado por acá). Nada de
esto sube nada solo; hay que hacerlo a propósito.

## 1. Conectar el repo

1. Subí esta carpeta a un repositorio de GitHub (privado, sugerido).
2. En [vercel.com](https://vercel.com) → **Add New… > Project** → elegís ese repo.
   Vercel detecta que es un proyecto Vite solo y usa los comandos por defecto
   (`npm run build`, carpeta de salida `dist`) — no hace falta tocar nada ahí.

## 2. Variables de entorno (Project Settings > Environment Variables)

Cargar estas tres, en **Production** (y en **Preview** si querés probar antes de
pasar a producción):

| Variable | Para qué | De dónde sale |
|---|---|---|
| `GCP_PROJECT_ID` | BigQuery — bajar el manifiesto de la guía | `sigma-star-2` |
| `GCP_SERVICE_ACCOUNT_JSON` | BigQuery — autenticación | Google Cloud Console → IAM y administración → Cuentas de servicio → crear una con roles **BigQuery Data Viewer** + **BigQuery Job User** sobre el proyecto `sigma-star-2` → generar clave JSON → pegar el JSON completo como valor de esta variable (como un solo string) |
| `ANTHROPIC_API_KEY` | Leer el comprobante de transferencia con IA | [console.anthropic.com](https://console.anthropic.com) → Settings → API Keys (misma que ya usás para CobrApp, o una nueva si preferís separarlas) |

No hace falta ninguna variable de Firebase en Vercel: la configuración de Firebase
(`src/firebase.js`) va directo en el código porque es pública por diseño (no es un
secreto — lo que protege los datos son las reglas de `firestore.rules`, no ocultar
esa config).

## 3. Deploy

Con las variables cargadas, cualquier push a la rama principal dispara un deploy
automático. El primer deploy manual se puede disparar también desde el botón
**Deploy** del dashboard de Vercel.

## 4. Instalar la app en el celular del chofer

Una vez desplegada, el chofer abre el link de Vercel en Chrome (Android) y usa
**Agregar a pantalla de inicio** — queda instalada como una app normal, con su
ícono, y funciona sin señal salvo por el primer paso de cada guía (bajar el
manifiesto).

## Orden recomendado

1. Primero Firebase (`FIREBASE_SETUP.md`) — sin esto la app no guarda nada.
2. Después las variables de Vercel de esta guía — sin esto no se puede bajar
   ninguna guía de BigQuery ni leer comprobantes de transferencia.
3. Recién ahí, deploy.

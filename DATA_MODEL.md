# Modelo de datos — App de Reparto (V2, en prueba)

**Esta es la versión 2 (proyecto `reparto-app-v2`), separada de la app en producción.**
La diferencia principal con la V1 es cómo se carga la devolución: en vez de que el chofer
tipee un monto devuelto a mano, el manifiesto trae el detalle de artículos de cada
comprobante y el chofer marca cantidad devuelta por artículo — la app calcula sola el
monto (ver "Devolución por artículo" más abajo). El resto del modelo (cobro, cierre,
alertas, transferencias, avisos) es igual a la V1.

## Origen: BigQuery

`GET /api/guia?guia_id=NNNN` (ver `api/guia.js`) consulta `sigma-star-2.sigmarepo.bq_ventas`
filtrando por `GUIA_ID` y devuelve el manifiesto agrupado por cliente → comprobante →
artículo (antes se agrupaba directo a nivel comprobante con `SUM(ITEM_NETO)`; ahora se
trae cada línea de artículo tal cual está en la tabla, y el monto por comprobante/cliente
se sigue calculando sumando esas líneas):

```json
{
  "guia_id": 4277,
  "reparto_codigo": "511",
  "reparto_nombre": "S. CARLOS GESSLER",
  "fecha": "2026-09-09",
  "total_guia": 3456789.12,
  "clientes": [
    {
      "cliente_id": 800015614,
      "nombre": "AGUIRRE MARIA ELENA",
      "direccion": "CORRIENTES 896   SAN CARLOS CENTRO",
      "localidad": "SAN CARLOS CENTRO",
      "zona": "LUCIANO 33/34/35",
      "lat": -31.7422925,
      "lon": -61.100803,
      "monto_total": 448732.32,
      "comprobantes": [
        {
          "numero": "00178076",
          "tipo": "F",
          "condicion_venta": "00",
          "condicion_venta_desc": "Contado",
          "espera_cobro_inmediato": true,
          "monto": 448732.32,
          "items": [
            {
              "descripcion": "ACEITE GIRASOL 1.5L",
              "cantidad": 12,
              "precio_unitario": 2100.5,
              "neto": 25206.0
            }
          ]
        }
      ]
    }
  ]
}
```

Al guardar el manifiesto en Firestore (`crearGuiaDesdeManifiesto`), cada línea de artículo
arranca con `cantidadDevuelta: 0` agregado — ese campo es el que va tocando el chofer.

## Devolución por artículo (reemplaza al monto devuelto tipeado a mano)

En la pantalla de entrega, cuando el estado es **Parcial** o **No entregó**, en vez del
campo "Monto devuelto" aparece la lista de artículos del pedido con un selector +/- de
cantidad devuelta por línea (`cambiarCantidad()` / `setCantidadDevuelta()` en
`DetalleCliente.jsx`). El monto devuelto se calcula solo, sumando por cada artículo
marcado: `cantidadDevuelta × (item.neto / item.cantidad)` — se usa el neto dividido la
cantidad pedida (no el precio de lista) para que cualquier descuento que ya tenía el
artículo se respete proporcionalmente.

- **No entregó**: se marca automáticamente la cantidad devuelta al máximo en todos los
  artículos (vuelve el pedido entero) — el chofer no tiene que tocar nada, la lista queda
  solo como referencia de qué vuelve.
- **Completa**: se destildan todas las cantidades (por si venían marcadas de haber
  probado "Parcial" antes de corregir el estado).
- **Parcial**: el chofer marca artículo por artículo cuánto vuelve.
- El motivo de la devolución (`motivoDevolucion`, tabla de motivos de nc del ERP) sigue
  siendo **uno solo por cliente**, no por artículo — decisión tomada con Germán para no
  agregarle más carga al chofer.
- Al guardar (`guardarEntregaCliente`), se persiste la copia de `comprobantes` con las
  `cantidadDevuelta` marcadas, además de `montoDevuelto` (la suma) — queda como registro
  de qué artículos puntuales se rechazaron, no solo cuánto.

La condición de venta es **solo informativa**: el chofer decide en el momento si cobra o
si el cliente queda en cuenta corriente, sin importar lo que diga el comprobante. Por eso
`espera_cobro_inmediato` no filtra ni bloquea nada en la app — solo alimenta la alerta de
cierre (ver más abajo).

## Implementación

- `src/firebase.js` — inicializa Firebase con persistencia offline de Firestore.
- `src/auth.js` — sesión anónima de Firebase (la exigen las reglas de seguridad).
- `src/data/guias.js` — toda la lectura/escritura a Firestore: crear la guía desde el
  manifiesto de BigQuery, listar clientes (ya ordenados por condición + nombre), guardar
  la entrega/cobro de un cliente, cerrar la guía (calcula totales y alertas) y listar los
  cheques de toda la guía. Los componentes de React llaman estas funciones, no tocan
  Firestore directo.
- `firestore.rules` — exige sesión anónima para leer/escribir (ver `FIREBASE_SETUP.md`).
- `src/App.jsx` — máquina de estados de pantallas (login → lista → detalle → cierre),
  conectada a `src/data/guias.js` y a `GET /api/guia`. Si el chofer reabre la app a mitad
  de un reparto ya iniciado, nunca vuelve a bajar el manifiesto (no pisa lo ya cargado); si
  reabre una guía ya cerrada, va directo a la pantalla de rendición.
- `src/screens/Login.jsx`, `ListaClientes.jsx` — selección de chofer/guía y listado de
  clientes con progreso. El desplegable de choferes se lee de Firestore
  (`src/data/choferes.js`, colección `choferes`) — se administra desde
  `/admin → Choferes` (`src/admin/screens/AdminChoferes.jsx`), no hace falta tocar código
  para dar de alta o baja un chofer.
- `src/screens/DetalleCliente.jsx` — pantalla de entrega + cobro por cliente: estado de
  entrega, devolución (se descuenta antes de cobrar), medios de pago combinables, alta de
  cheques (número/banco/fecha/monto) y escaneo real del comprobante de transferencia
  (`compressImage.js` + `POST /api/process`, con validación del chofer antes de guardar).
  Guarda con `guardarEntregaCliente()`.
- `src/screens/Cierre.jsx` — pantalla de rendición: totales, alertas, detalle de cobranza
  por cheques y detalle por cliente (ordenado por condición predeterminada + nombre, con esa
  columna). Exporta CSV real (descarga de archivo) y arma el resumen para compartir por
  WhatsApp (`wa.me`).
- `src/utils/compressImage.js` — comprime la foto del comprobante en el cliente antes de
  mandarla a `/api/process` (límite de payload de Vercel).
- `api/process.js` — función serverless que lee el comprobante con IA (Anthropic,
  `claude-sonnet-4-6`) y devuelve el monto detectado para que el chofer lo confirme.
- `src/styles.css` — estilos de toda la app (colores/tipografía institucionales), portados
  y adaptados de la vista previa validada con Germán.
- PWA: `public/icons/icon-192.png`, `icon-512.png` (generados a partir del isologo real) y
  `public/favicon.svg`, referenciados desde `vite.config.js`.

### Panel de administración (`/admin`)

Vive en el mismo build que la app del chofer, separado por ruta (`src/main.jsx` decide
entre uno y otro según `window.location.pathname`, sin librería de routing). Es de solo
lectura — no escribe nada en Firestore.

- `src/admin/adminAuth.js` — login real (Firebase Auth Email/Password), distinto de la
  sesión anónima del chofer. Los usuarios se crean a mano desde Firebase Console, ver
  `ADMIN_SETUP.md`.
- `src/admin/AdminApp.jsx` — pantalla login → dashboard → detalle de guía.
- `src/admin/screens/AdminDashboard.jsx` — filtro por fecha (hoy/7/30 días/todo), KPIs
  generales, tabla de guías y tabla de incidencias (entregas parciales, no entregados y
  las mismas alertas de cta. cte. que ve el chofer al cerrar), consolidadas entre todos
  los choferes y guías del rango.
- `src/admin/screens/AdminGuiaDetalle.jsx` — reusa el componente `Cierre` de la app del
  chofer para mostrar la rendición de cualquier guía (esté abierta o cerrada todavía).
- `src/data/admin.js` — lectura consolidada: `listarGuiasRecientes()`,
  `calcularResumenGuia(guiaId)` (misma fórmula que `cerrarGuia()` pero sin escribir, sirve
  para guías aún no cerradas) y `calcularResumenGlobal({desde, hasta})`.
- `src/data/guias.js` ahora expone `calcularTotalesYAlertas(clientes)` como función pura
  (extraída de `cerrarGuia()`) para que el panel de admin la reuse sin duplicar la lógica.
- Se agregó un campo `motivoDevolucion` que el chofer carga (desplegable, opcional) cuando
  marca una entrega parcial o "no entregó" — es lo que alimenta la columna de motivo en la
  tabla de incidencias del panel. Usa los mismos códigos que la "Tabla de motivos de nc"
  del ERP Sigma2k (`src/lib/motivosDevolucion.js`, a mantener en sincro si el ERP cambia
  esa tabla), guardando el código en Firestore; el panel de admin lo muestra traducido a
  su nombre (`describirMotivoDevolucion()`).
- `vercel.json` — rewrite para que entrar directo a `/admin` (no solo navegando desde
  `/`) sirva `index.html` en vez de dar 404, sin afectar `/api/*`.

## Firestore (estado del reparto, con persistencia offline)

```
guias/{guiaId}
  guia_id: number
  reparto_codigo, reparto_nombre: string
  fecha: string (YYYY-MM-DD)
  chofer_nombre: string
  estado: "abierta" | "cerrada"
  fecha_apertura: timestamp
  fecha_cierre: timestamp | null
  total_guia: number            // copiado de BQ al abrir
  totales: {                    // calculado al cerrar (ver fórmulas abajo)
    total_guia, total_entregado, total_devuelto,
    total_cta_cte, total_efectivo, total_cheque,
    total_transferencia, neto_a_rendir
  } | null
  alertas: [ { cliente_id, cliente_nombre, comprobante, motivo } ]  // ver abajo
  aviso_fin_reparto: boolean       // el chofer avisó que terminó de repartir (ver abajo)
  aviso_fin_reparto_en: timestamp | null

  guias/{guiaId}/clientes/{clienteId}
    cliente_id, nombre, direccion, localidad, zona, lat, lon
    comprobantes: [ { numero, tipo, condicion_venta, condicion_venta_desc,
                       espera_cobro_inmediato, monto } ]
    monto_total: number
    estado_entrega: "pendiente" | "entregado_completo" | "entregado_parcial" | "no_entregado"
    monto_entregado: number       // lo que efectivamente se entregó
    monto_devuelto: number        // monto_total - monto_entregado
    motivo_devolucion: string | null
    pagos: [ { medio: "efectivo" | "cheque" | "transferencia", monto: number, detalle?: string } ]
    cheques_detalle: [ { numero: string, banco: string, fecha: string (YYYY-MM-DD), monto: number } ]
      // uno por cada cheque físico recibido de ese cliente (puede haber varios);
      // la suma de cheques_detalle == el monto del pago con medio "cheque"
    transferencias_detalle: [ { referencia: string, monto: number } ]
      // una por cada transferencia recibida de ese cliente (puede haber varias, igual que
      // los cheques); "referencia" es lo que detectó la IA en el comprobante (banco/
      // billetera, CBU o alias, número de operación) o lo que tipeó el chofer a mano si
      // no escaneó; la suma de transferencias_detalle == el monto del pago con medio
      // "transferencia"
    monto_cobrado: number         // suma de pagos
    monto_cta_cte: number         // monto_entregado - monto_cobrado (si > 0)
    visitado_en: timestamp | null
```

Firestore se inicializa con persistencia offline (`enableIndexedDbPersistence` /
`initializeFirestore` con `localCache`), así que mientras el chofer está sin señal sigue
leyendo y escribiendo contra la copia local; Firestore sincroniza solo cuando vuelve la
conexión. Lo único que necesita señal sí o sí es el paso inicial (`/api/guia`) para bajar
el manifiesto de la guía.

## Regla de UI: la devolución se descuenta antes de cobrar

Cuando el chofer marca una entrega **parcial** (o **no entregada**), la app tiene que
mostrarle el monto ya descontado — `monto_entregado = monto_total − monto_devuelto` —
como el número que tiene que cobrar, en vez de dejar que reste la devolución de memoria
sobre el total original. La pantalla de cobro siempre trabaja contra `monto_entregado`,
nunca contra `monto_total`. (Implementado en la vista previa: línea "Entrega neta" en el
bloque de entrega + línea "Monto a cobrar" al tope del bloque de cobro, ambas recalculadas
en vivo apenas cambia el monto devuelto.)

El bloque de cobro va un paso más allá: en vez de un "Monto a cobrar" fijo, muestra un
único número grande **"Falta cobrar"** que arranca en `monto_entregado` y se va
descontando en vivo a medida que el chofer tilda y carga efectivo, cheque o transferencia
— llega a $0 cuando está todo cobrado. Si en algún momento lo cargado supera lo que había
que cobrar, en vez de mostrar una cuenta corriente negativa avisa "Cobraste $X de más"
para que el chofer revise el monto. Lo que queda sin cubrir al guardar es lo que pasa a
`monto_cta_cte` (ver fórmulas abajo). También se muestra la condición de venta de cada
cliente (Contado / Cta Cte, ver `src/lib/condiciones.js`) como badge en la lista de
clientes y como chip destacado en el detalle, junto a los comprobantes — es solo
informativa, no cambia ninguna lógica de cobro.

Al activar un medio de pago (tocar el chip "Efectivo" / "Cheque" / "Transf."), el importe
se precarga por defecto con el saldo pendiente en ese momento (`faltaCobrar`) — así el
chofer no tiene que tipear el monto completo cuando cobra todo en un solo medio; si combina
medios, cada chip nuevo se precarga con lo que quede sin cubrir hasta ese momento, y el
chofer puede corregir el número en vez de partir de cero. Implementado en `togglePago()` en
`src/screens/DetalleCliente.jsx`.

"Falta cobrar" (y "Entrega neta") se recalculan al salir de cada campo (`onBlur`), no en
cada tecla — cada monto (devuelto, efectivo, cheque, transferencia) tiene un estado
"cargado" en paralelo al que muestra el input, y el neteo lee siempre de ese estado
"cargado". Así el número no salta mientras el chofer todavía está tipeando un importe.
Al agregar un cheque/transferencia a la lista, o al tocar "Guardar" sin haber salido antes
del campo, se usa el valor recién tipeado igual (no se pierde lo cargado por no haber
perdido el foco). Implementado en `src/screens/DetalleCliente.jsx`.

## Fórmulas del cierre

- `total_entregado` = Σ `monto_entregado` de todos los clientes
- `total_devuelto` = Σ `monto_devuelto`
- `monto_cta_cte` (por cliente) = `monto_entregado` − `monto_cobrado` (si da > 0)
- `total_cta_cte` = Σ `monto_cta_cte`
- `total_efectivo` / `total_cheque` / `total_transferencia` = Σ de los pagos de ese medio
- `neto_a_rendir` = `total_efectivo` + `total_cheque`
  (las transferencias no se cuentan porque ya ingresaron directo a la cuenta bancaria —
  **confirmado con Germán**)

## Alertas de cierre

Por pedido de Germán: el reporte final debe avisar cuándo lo cobrado no coincide con la
condición de venta nominal del comprobante. Regla propuesta para la v1 (a ajustar con el
uso real):

- Alerta **"Debía cobrarse al contado"**: el comprobante tiene `espera_cobro_inmediato = true`
  (condición 00/05/06) pero el cliente terminó con `monto_cta_cte > 0`.
- Alerta **"Cta Cte cobrada"** (informativa, menor severidad): el comprobante tiene
  `espera_cobro_inmediato = false` (Cta Cte 5/12/3 días, etc.) pero igual se cobró de
  contado — no es un error, pero puede ser útil que administración lo vea.

Estas alertas se calculan al cerrar la guía y quedan guardadas en `guias/{guiaId}.alertas`
para mostrarlas en el panel de administración y en el export.

## Aviso de fin de reparto

En la lista de clientes, arriba del botón "Cerrar guía y ver rendición", hay un botón
**"📣 Avisar que terminé el reparto"** — es una acción separada de cerrar la guía: el
chofer puede terminar todas las entregas y avisar enseguida, aunque recién rinda cuentas
(cierre) más tarde. Al tocarlo se marca `aviso_fin_reparto = true` (y la hora) en la guía;
el panel de admin muestra una sección "📣 Avisaron que terminaron" con las guías abiertas
que tienen el aviso prendido, para saber que ese chofer ya está por volver sin depender de
que mande un mensaje aparte. El botón se deshabilita después de tocado (no se puede avisar
dos veces) — `avisarFinReparto()` en `src/data/guias.js`.

Si el chofer avisó y después carga o corrige una entrega (`guardarEntregaCliente()`), el
aviso se destilda solo — se resetea `aviso_fin_reparto` a `false` en la misma escritura
(batch), para que no quede "avisé que terminé" prendido mientras todavía sigue tocando
entregas; tiene que volver a apretar el botón para confirmar que ahora sí terminó. La
lista de clientes se sincroniza con ese valor real cada vez que vuelve de cargar un
cliente (`App.jsx` vuelve a leer la guía en `backToLista()`).

La sección "📣 Avisaron que terminaron" solo lista guías todavía **abiertas** (es una lista
de pendientes de cerrar) — en cuanto se cierra/rinde la guía, sale de esa lista porque ya
no queda nada pendiente. Igual queda un ícono 📣 al lado del estado en la tabla "Guías" de
abajo, para cualquier guía que haya tenido el aviso prendido, esté abierta o cerrada — así
queda un registro visual de que el chofer avisó, aunque ya se haya cerrado la guía.

## Escaneo del comprobante de transferencia

Al tocar "Transferencia" el chofer puede escanear el comprobante con la cámara del celular,
elegirlo de la galería o abrirlo como PDF, en vez de tipear el monto a mano: se lee el
comprobante con IA (`claude-sonnet-4-6` vía un proxy serverless en `api/process.js`, con
compresión de imagen del lado del cliente para no pasarse del límite de payload de Vercel
— mismo aprendizaje que CobrApp) y la app le muestra al chofer el monto detectado, más una
referencia corta (banco/billetera, CBU o alias, número de operación — lo que haya en el
comprobante), para que confirme ("Agregar") o corrija los datos antes de sumarlos a la
lista de transferencias del cliente. Un cliente puede tener varias transferencias
(`transferencias_detalle`, igual que los cheques) — por ejemplo si paga en más de una
tanda — y también se puede cargar una transferencia a mano sin escanear, con monto y
referencia libres.

## Detalle de cobranza por cheques y por transferencias

Cuando el chofer carga un cheque, la app pide número de cheque, banco y fecha además del
monto (puede cargar varios cheques por cliente). En el reporte de cierre de la guía va una
sección aparte, "Detalle de cobranza por cheques", con un renglón por cada cheque recibido
en toda la guía: cliente, número, banco, fecha y monto — para que administración pueda
depositarlos/rastrearlos sin tener que abrir cada cliente.

De la misma forma, hay una sección "Detalle de transferencias" con un renglón por cada
transferencia recibida en toda la guía: cliente, referencia y monto. Ambas secciones viven
en el componente compartido `Cierre.jsx` (chofer al cerrar la guía, y panel de admin al
abrir el detalle de cualquier guía vía `AdminGuiaDetalle.jsx`), y se exportan también en el
CSV de rendición (`src/data/guias.js` expone `listarTransferenciasDeGuia()` igual que
`listarChequesDeGuia()`).

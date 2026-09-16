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
se sigue calculando sumando esas líneas).

**Importante — el campo `neto`/`item_neto` usa `ITEM_FINAL`, no `ITEM_NETO`.** `ITEM_NETO`
es el subtotal de la factura SIN IVA; `ITEM_FINAL` es el monto real (neto + IVA +
impuestos internos), el que efectivamente hay que cobrarle al cliente — y también el que
hay que descontar si un artículo vuelve. Se detectó con Germán el 2026-09-14 comparando
contra el ERP: usar `ITEM_NETO` hacía que el total y el descuento por devolución quedaran
~20% por debajo de lo real en cualquier comprobante con IVA discriminado (prácticamente
todos). El campo sigue llamándose `neto`/`item_neto` en el código por no romper nada que
ya lo usa, pero el valor que trae es el final con IVA incluido. El mismo fix se aplicó en
la V1 de producción (`reparto-app/api/guia.js`), porque tenía el mismo problema.

**Importante — algunos comprobantes llevan además una "Percepción de IVA a terceros" que
no está en `bq_ventas` (solo V2, no aplicado todavía en V1).** Detectado con Germán el
2026-09-15 comparando otra vez contra el ERP: a ciertos clientes (según su condición
fiscal) Sigma2k les suma al total de la factura una percepción de IVA aparte del IVA
discriminado por artículo. Ese monto no existe en ninguna de las ~140 columnas de
`bq_ventas` — vive en la tabla contable `sigma-star-2.sigmarepo.bq_contable`, como un
asiento aparte (cuenta `21418` "PERCEP IVA A TERCEROS") dentro del mismo movimiento
contable de la factura (junto a la cuenta `41101` "VENTA DE MERCADERIAS" y la `21421`
"IVA DEBITO FISCAL").

`api/guia.js` la trae con una segunda consulta (`PERCEPCION_QUERY`) después de armar el
manifiesto: agrupa `bq_contable` por movimiento (`ID`) — **sin filtrar ni agrupar por
`SUBCUENTA`**, porque ese campo (que sería el `CLIENTE_ID`) solo viene cargado en la línea
"DEUDORES POR VENTAS" de cada movimiento; en las demás líneas (mercadería, IVA,
percepción) `SUBCUENTA` viene en `0`. Agrupando por `ID` primero y sacando recién ahí el
cliente con `MAX(SUBCUENTA)`, cada movimiento con percepción queda identificado por
`fecha + cliente_id + monto de mercadería sin IVA` — esa combinación se cruza contra
`fecha + cliente_id + SUM(ITEM_NETO)` del comprobante en `bq_ventas` (no hay un campo de
número de comprobante en `bq_contable` para unir directo). Cuando coincide, la percepción
se suma al `monto` de ese comprobante y al `monto_total` del cliente — no aparece como un
artículo más, porque no es mercadería.

**El cruce es por monto más cercano, con tolerancia de 2 centavos — no por igualdad
exacta.** Detectado con la guía 4295 (2026-09-16): en varios comprobantes el monto de
mercadería sin IVA difiere en 1 o 2 centavos entre `bq_ventas` (suma de `ITEM_NETO`
redondeado línea por línea) y `bq_contable` (`HABER` de la cuenta `41101`, redondeado del
lado contable) — son dos cálculos distintos dentro de Sigma2k, no un error de acá, pero
con un cruce por igualdad exacta de string esos comprobantes perdían la percepción entera
(en esa guía, 3 de 8 comprobantes con percepción — $21.171 de $56.865). Ahora se agrupan
los movimientos de `bq_contable` por `fecha + cliente_id` (sin el monto en la clave) y,
para cada comprobante, se busca entre esos movimientos el de monto de mercadería más
cercano, aceptando hasta $0,02 de diferencia; una vez usado un movimiento no se lo vuelve a
usar para otro comprobante del mismo cliente/día (para no duplicar percepción si hay más
de un comprobante con montos parecidos).

Confirmado con el comprobante 00178649 de la guía 4290 (López Branco Valentín): mercadería
$184.343,52 + IVA $36.295,08 + percepción $5.185,01 = $225.823,61, igual que en Sigma2k. Y
con la guía 4295 completa: 8 de 26 comprobantes con percepción, $56.864,82 en total —
sumado al resto, el total de la guía pasa de $4.831.769,10 a $4.888.633,92, igual que en el
ERP. Solo afecta a una parte de los comprobantes (~15% en los últimos 30 días, ~$9,6M
acumulados) — el resto de los clientes no tiene percepción y la consulta simplemente no
les devuelve movimiento. **Limitación conocida:** si un comprobante con percepción se
marca con entrega **parcial**, el descuento por artículo no reduce la percepción de forma
proporcional (queda completa en el saldo a cobrar) — solo se descuenta del todo cuando el
comprobante queda **no entregado**. Por ahora no se pidió resolver ese caso puntual.

**Si después de deployar este cruce tolerante una guía sigue sin sumar la percepción**,
antes de sospechar del código conviene confirmar que el deploy en Vercel efectivamente
levantó el commit nuevo (a veces el zip subido a GitHub no es el último) — una guía que ya
existía en Firestore antes del deploy nunca se vuelve a traer sola de BigQuery (ver más
abajo), así que hay que borrarla desde el panel de admin y que el chofer la vuelva a tomar
para que se recalcule con el código actualizado.

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
marcado: `cantidadDevuelta × (item.neto / item.cantidad)` — se usa `item.neto` (que trae
`ITEM_FINAL`, con IVA y descuentos ya incluidos) dividido la cantidad pedida, para que el
monto devuelto sea el real que pagó el cliente por esa unidad, no el precio de lista.

- **No entregó**: se marca automáticamente la cantidad devuelta al máximo en todos los
  artículos (vuelve el pedido entero) — el chofer no tiene que tocar nada, la lista queda
  solo como referencia de qué vuelve.
- **Completa**: se destildan todas las cantidades (por si venían marcadas de haber
  probado "Parcial" antes de corregir el estado).
- **Parcial**: el chofer marca artículo por artículo cuánto vuelve.
- Cada artículo muestra su código (`ITEM_ARTICULO` de bq_ventas, campo `codigo` en el
  ítem) debajo de la descripción, junto con la cantidad pedida y el N° de comprobante.
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
- `src/admin/screens/AdminDashboard.jsx` — filtro por fecha (Actual/7 días/Todo), KPIs
  generales, tabla de guías y tabla de incidencias (entregas parciales, no entregados y
  las mismas alertas de cta. cte. que ve el chofer al cerrar), consolidadas entre todos
  los choferes y guías del rango.
- `src/admin/screens/AdminGuiaDetalle.jsx` — reusa el componente `Cierre` de la app del
  chofer para mostrar la rendición de cualquier guía (esté abierta o cerrada todavía).
- `src/data/admin.js` — lectura consolidada: `listarGuiasRecientes()`,
  `calcularResumenGuia(guiaId)` (misma fórmula que `cerrarGuia()` pero sin escribir, sirve
  para guías aún no cerradas) y `calcularResumenGlobal({desde, hasta} | {actual: true})`.

**Filtro "Actual" — no es "hoy" por calendario.** Detectado con Germán el 2026-09-16: la
`fecha` de la guía es la del comprobante en Sigma2k, que suele quedar un día atrás del
reparto real (o la del sábado si el reparto es el lunes) — filtrar por la fecha de hoy
siempre daba "sin guías en este rango". El filtro que antes se llamaba "Hoy" (y filtraba
por la fecha de hoy) pasó a llamarse **"Actual"**: en vez de usar la fecha del calendario,
`calcularResumenGlobal({actual: true})` busca la fecha más reciente que efectivamente haya
entre las guías traídas y filtra por esa — así siempre muestra el último reparto cargado,
sea cual sea su fecha real. También se sacó el filtro "30 días" (no se usaba) — quedan
Actual, 7 días y Todo.
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

**Umbral de $1 para no alertar por centavos de redondeo.** Detectado con Germán el
2026-09-15: sumar varias líneas de artículo (o la percepción de IVA — ver "Origen:
BigQuery") puede dejar un resto de unos pocos centavos que no es una cuenta corriente
real, y esas alertas de $0,12 o $0,37 solo generan ruido. `calcularTotalesYAlertas()` en
`src/data/guias.js` solo dispara las dos alertas de arriba cuando el monto en cuestión
(`montoCtaCte` o `montoCobrado`) es `>= $1` — por debajo de eso no alerta, aunque el monto
siga sumado correctamente en los totales. El mismo umbral se usa en `Cierre.jsx` para la
lista de "Clientes en cuenta corriente" (ver más abajo): un cliente que ya transfirió el
pago completo, pero le quedó un resto de centavos en `montoCtaCte` por una diferencia de
redondeo entre el monto de la factura y el monto transferido, no aparece ahí (detectado
con la guía 4295 el 2026-09-16 — mostraba clientes que en realidad pagaron por
transferencia, con $0, en la lista de cuenta corriente).

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

### Llave del fin de reparto (aviso al admin si hubo cambios después)

El botón de aviso funciona como una "llave": si el chofer ya tocó "Avisar que terminé el
reparto" y **después** carga o corrige una entrega, no alcanza con destildar el aviso en
silencio — administración tiene que enterarse explícitamente de que hubo cambios luego de
esa señal, porque puede significar que el chofer se dio cuenta de un error después de haber
dicho que ya estaba todo listo.

- `crearGuiaDesdeManifiesto()` arranca la guía con `modificadoLuegoDeAviso: false` y
  `modificadoLuegoDeAvisoEn: null`.
- `guardarEntregaCliente()` lee el estado actual de la guía antes de escribir; si
  `avisoFinReparto` ya estaba en `true`, además de destildarlo (como antes) prende
  `modificadoLuegoDeAviso: true` y guarda la hora en `modificadoLuegoDeAvisoEn`.
- `avisarFinReparto()` — cuando el chofer vuelve a avisar (ya sea la primera vez o
  reconfirmando después de un cambio) — apaga `modificadoLuegoDeAviso` de nuevo, porque esa
  nueva confirmación reemplaza a la anterior.
- El panel de admin (`AdminDashboard.jsx`) muestra una sección propia
  "⚠️ Avisaron pero modificaron algo después" con las guías abiertas en ese estado (aparece
  arriba de "📣 Avisaron que terminaron"), y en la tabla "Guías" el ícono de la fila pasa de
  📣 a ⚠️ mientras el flag esté prendido. `Cierre.jsx` (que reusan tanto la rendición del
  chofer como el detalle de guía del admin) también muestra un cartel de alerta arriba de
  todo si `guia.modificadoLuegoDeAviso` es `true`, para que no pase desapercibido ni
  siquiera abriendo la guía puntual. El flag no se borra solo al cerrar la guía — queda
  como registro de que hubo un cambio de último momento, aunque ya se haya rendido.

## Sesión activa en el celular (retomar guía sin volver a tipear)

Para que el chofer no tenga que volver a escribir el número de guía cada vez que sale de
la app y vuelve a entrar a mitad de reparto (el celular la mata en segundo plano, por
ejemplo), `src/lib/sesion.js` guarda `{ chofer, guiaId }` en `localStorage` de ese celular
apenas arranca o retoma una guía que **no** está cerrada. Al abrir la app, `App.jsx` lee esa
sesión en un `useEffect` de montaje y llama a `handleIniciar()` solo, sin que el chofer
tenga que tocar nada — si todo sale bien, entra directo a la lista de clientes (o a la
rendición, si la guía ya estaba cerrada) en vez de mostrar el login.

La sesión se borra sola cuando ya no queda reparto activo que retomar: al cerrar la guía
(`handleCerrar()`) y al confirmar una guía que resulta estar cerrada al reabrir la app. El
chofer también puede soltarla a mano con el botón **"Cambiar de guía"** en la barra de
arriba de la lista de clientes (`onNuevaGuia` en `App.jsx`) — por ejemplo si tipeó mal el
número, o si terminó y quiere arrancar otra guía sin pasar por el cierre de la anterior.
Es solo una conveniencia local del celular: no toca nada en Firestore, así que si falla
(modo privado, cuota llena) el chofer simplemente vuelve a tipear la guía como antes.

## Escaneo del comprobante de transferencia

Al tocar "Transferencia" el chofer puede escanear el comprobante con la cámara del celular,
elegirlo de la galería o abrirlo como PDF, en vez de tipear el monto a mano: se lee el
comprobante con IA (`claude-sonnet-4-6` vía un proxy serverless en `api/process.js`, con
compresión de imagen del lado del cliente para no pasarse del límite de payload de Vercel
— mismo aprendizaje que CobrApp), y la app le muestra al chofer los datos detectados para
que confirme ("Agregar") o corrija antes de sumarlos a la lista de transferencias del
cliente. Un cliente puede tener varias transferencias (`transferenciasDetalle`, igual que
los cheques) — por ejemplo si paga en más de una tanda — y también se puede cargar una
transferencia a mano sin escanear, con monto y referencia libres.

**Campos del reporte — iguales a los de CobrApp (a pedido de Germán, 2026-09-15), para
poder conciliar los dos reportes de la misma forma.** Cada transferencia guarda: `monto`,
`fecha` (de la operación, tal cual figura en el comprobante), `origen` (nombre de quien
envía), `destino` (nombre de quien recibe), `referencia` (N° de operación), `bancoOrigen`,
`bancoDestino` y `cbuDestino`. `api/process.js` le pide estos mismos campos a la IA (con
`null` para lo que no aparezca en el comprobante, nunca un texto inventado) y solo
descarta el resultado completo si no pudo leer el monto con certeza — el resto de los
campos pueden venir vacíos sin problema. Si el chofer corrige el monto o la referencia de
un escaneo antes de confirmar (`corregirScan` en `DetalleCliente.jsx`), el resto de los
datos detectados no se pierde — se guarda aparte (`transExtra`) y se suma igual al
confirmar. Una transferencia cargada 100% a mano (sin escanear) solo tiene `referencia` y
`monto`; los demás campos quedan vacíos porque no hay de dónde sacarlos.

`listarTransferenciasDeGuia()` en `src/data/guias.js` arma el reporte completo por guía,
agregando el código y nombre del cliente a cada transferencia (`clienteId`, `clienteNombre`
— vienen del documento del cliente, no del comprobante). El CSV de rendición
(`Cierre.jsx → descargarCsv()`) exporta la sección "Detalle de transferencias" con las
columnas en este orden: Código cliente, Nombre, Monto, Fecha, Origen, Destino, Referencia,
Banco de Origen, Banco de Destino, CBU destino.

## Borrar una guía (limpieza de guías de prueba)

`eliminarGuia(guiaId)` en `src/data/guias.js` borra el documento de la guía y todos sus
clientes (Firestore no borra subcolecciones en cascada solo). Se usa desde el panel de
admin: `AdminGuiaDetalle.jsx` le pasa `onEliminarGuia` a `Cierre.jsx`, que muestra una
"Zona de peligro" con el botón "🗑 Eliminar esta guía" (confirmación en dos toques, sin
usar el `confirm()` del navegador). El chofer (`App.jsx`) nunca pasa ese prop, así que
nunca ve la opción — borrar una guía es una acción de administración. Pensado para poder
limpiar las guías usadas mientras se prueba la V2, sin tener que tocar Firestore a mano.

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

**Las pastillas abren su detalle al tocarlas, no se muestran todas de una.** Devuelto,
Cta. corriente, Transferencias y Cheques son botones (`tot-tile clickable`) — al tocar
uno se abre, debajo del grid de totales, un panel con el detalle consolidado de esa guía
(y toca otra vez para cerrarlo; tocar una pastilla distinta cambia el panel). El de
"Cta. corriente" lista los clientes con `montoCtaCte >= $1` (ver umbral de redondeo más
arriba). Efectivo y "Neto a rendir"
quedan como pastillas simples, sin detalle desplegable, porque no tienen un desglose
adicional que mostrar.

El de **"Devuelto" consolida por artículo, no por cliente**: `listarArticulosDevueltosDeGuia()`
en `src/data/guias.js` sigue armando una línea por cliente/comprobante/artículo (recorriendo
`comprobantes[].items[].cantidadDevuelta` de todos los clientes — eso no cambió, y es lo
que sigue exportando el CSV, línea por línea, para el detalle contable). Pero el panel que
ve el chofer al tocar la pastilla agrupa esas líneas por artículo (`Cierre.jsx`,
`articulosConsolidados`, agrupando por código o por descripción si el artículo no tiene
código) y suma cantidad y monto entre todos los clientes que lo devolvieron — así el chofer
puede cotejar de un vistazo el total de cada artículo contra la mercadería física que trae
de vuelta en el camión, en vez de tener que sumar a mano varias filas del mismo producto
repartidas entre distintos clientes. Si más de un cliente devolvió el mismo artículo, el
renglón consolidado aclara "· N clientes".

Debajo de ese consolidado, el mismo panel de "Devuelto" agrega una segunda lista **"Por
cliente"**: todos los clientes con `estado === "parcial"` o `"no_entregado"`, con su
`montoDevuelto` — para poder ver, aparte del total por artículo, a qué cliente corresponde
cada devolución sin tener que entrar guía adentro cliente por cliente. Las dos listas
conviven en el mismo panel (primero artículos consolidados, después clientes).

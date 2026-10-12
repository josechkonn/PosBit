# Diseño: Configuración Global Centralizada, Multi-presentación, Multi-moneda y CPP

> Documento de arquitectura y lógica de negocio para el módulo de **Inventario & Pricing** de PosBit. Encaja con la stack actual: **Next.js + PostgreSQL sin ORM** (`node-postgres`, SQL idempotente en `sql/`, lógica de conversión centralizada en `src/lib/money.ts`).

**Entregables en este repositorio:**

| Entregable | Archivo |
|---|---|
| Modelo de BD (migración idempotente) | `sql/global-config-pricing.sql` |
| Configuración Global tipada | `src/lib/global-config.ts` |
| Servicio de costeo (CPP, cascada, redondeo, histórico) | `src/lib/costing.ts` |
| Este documento (controlador + casos borde) | `docs/diseno-modulo-inventario-pricing.md` |

---

## 1. Resumen del flujo (Set & Forget)

```
                    ┌────────────────────────────┐
                    │  CONFIGURACION_GLOBAL (1)  │  ← admin panel (una vez)
                    │  · método conv. compras    │     "set & forget"
                    │  · método conv. ventas     │
                    │  · auto_precio (toggle)    │
                    │  · redondeo (múltiplo)     │
                    └────────────┬───────────────┘
                                 │ leídos en la transacción
                                 ▼
   OPERADOR elige SOLO: Producto, Presentación (Unidad|Caja), Moneda factura, Costo
                                 │
                                 ▼
   ┌─────────────────────  GUARDAR COMPRA (POST /api/compras)  ─────────────────────┐
   │ 1. desglose a UNIDADES (1 Caja × 24 → 24 ud; costo ÷ 24)        [ya existe]    │
   │ 2. convertir costo unitario → moneda base (USD) con el MÉTODO   [global-config]│
   │    global de compras (directa | triangulación vía tránsito)                    │
   │ 3. CPP = (CPP × stock + costo_entrante × cant) / (stock + cant) [costing]      │
   │ 4. si auto_precio ON: precio_venta = CPP × (1 + margen/100)     [costing]      │
   │    → redondeo global → fija precio_base (Unidad)                              │
   │ 5. precio de la Caja se DERIVA en lectura (factor × precio_ud)  [ya existe]    │
   │ 6. registro histórico para autocompletar costos futuros         [costing]      │
   └──────────────────────────────────────┬─────────────────────────────────────────┘
                                          ▼
              la factura / UI muestra EXACTAMENTE lo tecleado: "1 Caja"
```

---

## 2. Modelo de base de datos

### 2.1 Conceptos clave

- **Unidad = unidad base matemática.** Stock, kardex, CPP y precios pivotan en unidades (ya es el diseño vigente de `producto_presentaciones.unidades` + `productos.stock`). Una presentación es solo un **factor de conversión** de entrada/salida. La presentación "Unidad" NO se guarda: es el factor implícito `1`.
- **Moneda base interna = moneda con `es_base = true` (USD).** Es el ancla donde se consolida el CPP. Todas las compras en cualquier moneda se reducen a USD antes de promediar; el CPP en la moneda de compra del producto se guarda además como columna de conveniencia.
- **Precio por presentación derivado en lectura** (`presentacionesDeProducto`): `precio_caja = precio_unidad × factor`. Esa es exactamente la propiedad bidireccional pedida: "Caja = Unidad × 24" y "Unidad = Caja ÷ 24" es una **transformación de presentación**, no un dato duplicado que pueda desincronizarse.

### 2.2 Tabla nueva: `configuracion_global` (fila única, tipada)

Se eligió una fila única con CHECK (`id = 1`) en vez de ampliar la tabla K:V `configuracion`: las reglas del motor se leen **juntas y atómicamente** (un solo `SELECT`, sin riesgo de mitad de claves actualizada), y quedan tipadas con CHECKs.

| Columna | Tipo | Significado |
|---|---|---|
| `metodo_conversion_compras` | `'directa' \| 'triangulacion'` | Cómo se convierte la moneda de la factura a la moneda base / a la moneda de costo del producto. |
| `metodo_conversion_ventas` | `'directa' \| 'triangulacion'` | Ídem para el lado ventas. |
| `moneda_transito_compras_id` / `moneda_transito_ventas_id` | FK `monedas` (nullable) | Moneda de tránsito obligatoria en triangulación (ej. USD → VES → COP). |
| `auto_precio_compra` | `boolean` | Toggle maestro del recálculo automático del precio de venta tras una compra. |
| `redondeo_activo` | `boolean` | Enciende/apaga la regla global de redondeo. |
| `redondeo_multiplo` | `decimal(18,2)` | Múltiplo (100, 500…); `0` = sin redondeo. |
| `redondeo_no_bajar_de_costo` | `boolean` | El redondeo nunca deja el precio por debajo del costo. |

### 2.3 Cambios en `productos`

| Columna nueva | Tipo | Significado |
|---|---|---|
| `margen_ganancia` | `decimal(5,2) DEFAULT 0` | % sobre el CPP para autocalcular el precio de venta. |
| `costo_promedio` | `decimal(18,6)` | CPP por unidad en la moneda de **compra** del producto. |
| `costo_promedio_base` | `decimal(18,6)` | CPP por unidad en la moneda **base** (USD). |
| `precio_auto` | `boolean` | `true` si el precio actual lo fijó la cascada (no una edición manual). Lo usa el job "Re recalcular precios" para no pisar precios a mano. |
| `precio_actualizado_en` | `timestamp` | Auditoría de cuándo se fijó el último precio. |

### 2.4 Tabla nueva: `producto_costos_historicos`

Snapshot de cada línea de compra **tal como se negoció** (moneda de factura, presentación, costo por presentación y derivación por unidad + su equivalente USD). Es la fuente del **autocompletado** de costos en compras futuras y queda limpia al anularse la compra (`ON DELETE CASCADE`; el rastro contable queda en `kardex` como `compra_anulada`).

### 2.5 Lo que NO se toca

- `producto_presentaciones`: ya tiene `unidades` (factor). Sin cambios.
- `compra_items`: ya tiene el snapshot de presentación comprada (`presentacion_*`, `costo_presentacion`) y `cantidad` **siempre en unidades**. Sin cambios.
- `configuracion` (K:V): sigue para empresa/IVA/stock. `inventario_metodo_costeo` se alinea a `'Promedio'` para no contradecir el CPP.

---

## 3. Lógica de negocio — Controlador "Guardar Compra"

Fragmento de integración sobre `src/app/api/compras/route.ts` (POST). El controlador sigue siendo una orquestación fina: **todo el cálculo vive en `src/lib/costing.ts`**.

```ts
// ── Después de cargar `monedasCatalogo` y `monedaCompra` (ya existe) ──
import { getConfiguracionGlobal, monedaTransitoDe } from "@/lib/global-config";
import {
  contextoCotizacion, convertirConMetodo,
  procesarItemCompra, ultimosCostosDeProducto,
} from "@/lib/costing";

// 1) LEER las reglas globales DENTRO de la transacción (set & forget).
const cfg = await getConfiguracionGlobal(client);
const baseSistema = monedasCatalogo.find((m: any) => m.es_base) ?? monedasCatalogo[0];

// 2) Contexto de conversión del lado compras (directa vs triangulación).
const ctxCompra = contextoCotizacion(cfg, "compras", monedasCatalogo);

// 3) En el bucle de items, TRAS normalizar la presentación:
for (const item of itemsNormalizados) {
  // costo unitario en la moneda de la factura → moneda base, CON el método global
  const costoUnitBase = convertirConMetodo(
    item.costo_unit, monedaCompra, baseSistema, ctxCompra, 6
  );

  const cascada = await procesarItemCompra(client, {
    item: { ...item, costo_unit_base: costoUnitBase },
    compraId: compra.id,
    compraNumero: compra.numero,
    monedaCompra, monedasCatalogo, baseSistema, cfg, ctxCompra,
  });

  // 4) El INSERT a compra_items y el kardex siguen exactamente como hoy,
  //    ahora con `costo_unit_base` = costoUnitBase (misma fuente que el CPP).
  //    (La UI sigue mostrando "1 Caja de 24" desde el snapshot.)
}

// 5) Autocompletado en el formulario de compras (misma vía de datos):
//    se consulta dentro de la ruta que sirve el formulario con su client.
const sugerencias = await ultimosCostosDeProducto(poolOrClient, productoId, {
  monedaId: monedaFactura, presentacionId: seleccionada,
});
// → el UI sugiere `costo_presentacion` del registro más reciente.
```

Flujo paso a paso del `procesarItemCompra` (ver `src/lib/costing.ts`):

1. **Costo entrante a USD** — `convertirConMetodo(costo_unit, monedaFactura, baseSistema, ctxCompra)`.
   - `directa` → par directo (regla `money.ts`).
   - `triangulacion` → dos saltos forzados `USD→transito→destino` (ej. factura en COP: COP→VES→USD).
2. **CPP** — `calcularCpp({ cpp, stock, costoUsd, cantidad })` = promedio ponderado en USD.
3. **CPP en moneda de compra del producto** — `desdeBase(cppBase, tasaUsd(monedaCosto))` → `productos.costo_promedio`.
4. **Cascada (si `auto_precio_compra`)**:
   - `cppEnMonedaVenta = convertirConMetodo(cppBase, base, monedaVenta, ctxCompra)` — la cascada es un efecto de la COMPRA, por lo que respeta el **método global de compras** (directa | triangulación vía tránsito), igual que el costo entrante.
   - `precio = cppEnMonedaVenta × (1 + margen_ganancia/100)`.
   - `aplicarReglasRedondeo(precio, cfg, suelo=cppEnMonedaVenta)`.
   - `UPDATE productos SET precio_base = precio, precio_auto = true`.
5. **Presentación** — nada que escribir: `precio_caja` se deriva en lectura.
6. **Histórico** — `INSERT producto_costos_historicos` con el snapshot exacto.

**Ubicación de la escritura del kardex:** se mantiene en el controlador, después de `procesarItemCompra`, con el `costo_unit_base` ya convertido por método global. En la anulación de compras, además de revertir stock, se llama a `recomputarCppDesdeKardex` (el promedio ponderado no es reversible algebraicamente; se recalcula del historial).

### Punto de integración en ventas

El kardex de salida y los reportes usan hoy `productos.costo_base` (estático). Deben migrar a:

```ts
// costo de la salida = CPP actual convertido desde la moneda base
const costoUnitUsd = Number(producto.costo_promedio_base) || costoEstaticoEnBase(...);
```

para que el margen bruto reportado sea coherente con el nuevo costeo. Esto NO cambia nada del precio de venta (la decisión de precio ya la tomó la cascada).

---

## 4. Pricing bidireccional (Unidad ↔ Presentación)

Es propiedad de las transformaciones, no una tabla extra:

```
precio_caja = redondear(precio_unidad × factor)      // Unidad → Caja
precio_unidad = redondear(precio_caja ÷ factor)      // Caja  → Unidad
```

- En el formulario de producto: si el usuario teclea "Caja = 24.000", el campo "Unidad" muestra "1.000" al instante, y viceversa (ya implementado en `producto-modal.tsx`, helpers en `money.ts`).
- En la cascada: al fijar `precio_base` (Unidad), **todas** las presentaciones se actualizan automáticamente porque se derivan en lectura.
- El costo por presentación para sugerencias usa la misma regla sobre `costo_promedio`.

---

## 5. Casos de uso y casos borde (Edge Cases)

### 5.1 Producto con margen de ganancia 0%
- `precioVentaDesdeCosto` fija precio = **CPP exacto** (vender a costo, utilidad 0). Es legítimo (ej. producto ancla, liquidación).
- El redondeo podría empujarlo por debajo del costo: `redondeo_no_bajar_de_costo = true` (default) lo clampa al costo (`Math.round` a 500 de 990 → 1.000, no 500). Si el negocio quiere "matar precio" con 0% y sin suelo, se apaga el flag.
- Nota de política: margen negativo se trata como 0 (nunca se autocalcula bajo costo).

### 5.2 Cambian el redondeo (o cualquier regla global) a mitad de jornada
- Las reglas globales se leen **dentro de la transacción** de cada compra y son **momentáneas**: lo que cambias afecta solo a las operaciones posteriores. Los `precio_base` ya fijados **no se re-escriben solos** (requisito: no sorprender al operador en el POS a mitad del día).
- Para realinear, el admin dispone del job **"Recalcular precios"**: `recalcularPreciosMasivo` re-aplica margen + redondeo vigentes **solo** a productos `precio_auto = true`. Los precios editados a mano jamás se pisan.
- Complemento de auditoría: `precio_actualizado_en` + `precio_auto` permiten ver qué se movió y cuándo.

### 5.3 Primera compra / producto sin CPP / CPP legacy
- `stock = 0` → el CPP de la primera compra **es** el costo entrante (fórmula `(0·cpp + costo)/0+n` degenera, se corta el caso especial).
- Stock > 0 con `costo_promedio_base = 0` (migración sin conversión) → se usa el costo estático convertido a USD como CPP inicial aproximado (`costoEstaticoEnBase`). La siguiente compra lo corrige naturalmente.

### 5.4 Compra en Caja (1 Caja = 24 ud)
- El controlador desglosa: `cantidad = 24 ud`, `costo_unit = costo_caja ÷ 24` (ya existe). El CPP opera en unidades. La factura y el detalle de la compra muestran **"1 Caja de 24 · costo 24.000"** (snapshot en `compra_items`), ocultando el desglose.
- Si después la compra se anula, el histórico se limpia (sugerencia fuera) y el stock/kardex revierten; el CPP se recomputa desde kardex.

### 5.5 Moneda de factura ≠ moneda de costo del producto
- Ej.: compra facturada en COP para un producto con costo en USD. La **triangulación** (`metodo_conversion_compras`, tránsito VES) fuerza `COP → VES → USD` explícito, ignorando el par directo COP↔USD; **directa** usa el par/referencia natural de `money.ts`.
- El CPP siempre confluye en USD, así las compras en monedas distintas promedian limpio.
- Si `triangulacion` está seleccionada pero falta `moneda_transito`, se cae a directa (la compra nunca se bloquea). Para evitarlo, la pantalla de Configuración **avisa y no permite guardar** el método de triangulación sin su moneda de tránsito.

### 5.6 Tasa personalizada del documento vs método global
- La tasa del documento (`compras.tasa`, usada para totales/saldo de caja) la mantiene el operador, como hoy. El **CPP** usa el método global de conversión de la línea (`costo_unit_base`). Si ambos coinciden (caso normal) no hay diferencia; si el operador mete una tasa custom distinta, esa diferencia es intencional (negociación del documento) y no contamina la valoración del inventario — se registra en el histórico el valor USD real aplicado.

### 5.7 Anulación de compra (reversa de CPP)
- El promedio ponderado no es "deshacible": anulado por álgebra directa falsearía el CPP. Solución: `recomputarCppDesdeKardex` replays el kardex cronológico, tratando `compra_anulada` como salida de stock (el costo de esa compra ya se fusionó). Esto mantiene el inventario consistente en cualquier orden de anulaciones.
- La venta anulada / retorno no toca CPP (solo stock): el costo fijo de la salida ya estaba tomado del CPP vigente.

### 5.8 Compras retroactivas o futuras (fecha)
- Si se registra una compra con `fecha` anterior, el CPP se recalcula **contra el stock actual** (el promedio no es retroactivo por período). Para un ERP de punto de venta esto es aceptable y se documenta al usuario; si se requiere exactitud por períodos, la misma mecánica del kardex permite reproducir un "cierre a fecha".

### 5.9 Presentación borrada después de la compra
- La compra guarda snapshot (`presentacion_nombre`, `presentacion_unidades`) y `compra_items.presentacion_id` usa `ON DELETE SET NULL`: la factura histórica no se rompe. El precio derivado de presentaciones activas se recalcula solo sobre las que existen.

### 5.10 Precio manual vs automático en conflicto
- Si el usuario ajusta a mano el precio de un producto y luego llega una compra con `auto_precio_compra`, la cascada lo sobreescribe y marca `precio_auto = true`. Documentar en la UI el aviso: *"El precio fue recalculado automáticamente tras la compra (CPP × margen)".* Para proteger un precio deliberadamente manual, el producto podría marcar `precio_auto = false` tras la edición manual + flag "fijar precio" (extensión propuesta, no implementada por defecto).

### 5.11 Redondeo global con múltiplo mayor que el precio
- Ej.: precio calculado 990, múltiplo 1.000 → `Math.round(990/1000)×1000 = 1.000` (sube); un precio de 490 con suelo de costo 500 quedaría en **500** (sube al suelo, no cae a 0). Nunca se genera precio 0 ni negativo por redondeo.

### 5.12 Redondeo y margen < costo por redondeo en cadena
- Siempre se aplica en el orden: CPP base (6 decimales) → moneda de venta (6) → margen → redondeo global (2 decimales) → suelo. No se reutilizan precios redondeados para recalcular otros (evita error acumulado).

### 5.13 El método de conversión aplica en TODA derivación de costo/precio
- La regla única vive en `money.ts`: `reglasConversion(cfg, catalogo)` traduce `configuracion_global` + catálogo a `{ compras, ventas }`, y `convertirConMetodo` las aplica. **Costo ⇒ regla de compras; precio ⇒ regla de ventas** (por defecto `directa`, retrocompatible).
- Se propaga a todos los puntos donde se deriva el costo/precio de un producto, para que "lo que se ve" sea igual a "lo que se guarda":
  - **Panel de producto** (`src/components/producto/producto-modal.tsx`): usa `useReglasConversion` (`src/lib/use-reglas-conversion.ts`); al teclear un costo/precio en una moneda, las demás se derivan con el método configurado. La comparación "compra ≤ venta" (`compraEnVentaMoneda`) usa la regla de compras.
  - **API de productos** (`GET/POST/PUT` y `/search`): `preciosDeProducto(..., reglas)` deriva precio (ventas) y costo (compras); la cascada de margen y el CPP inicial usan la regla de compras.
  - **Reportes de productos** (`/api/reportes`): `preciosDeProducto` con las mismas reglas.
  - **Kardex** (ajustes manuales y existencias iniciales): `costo_unit_base` se convierte con la regla de compras.
  - **Compras** (`procesarItemCompra`, `recomputarCppDesdeKardex`, `recalcularPreciosMasivo`) y el **CPP inicial legacy** (`costoEstaticoEnBase`) usan el método de compras.
- Pendiente (decisión abierta): los documentos del **POS/ventas** y sus pagos siguen usando el par directo; cablear `metodo_conversion_ventas` a los totales/pagos de venta queda para una tarea aparte (el precio base del producto ya se deriva con la regla de ventas).

---

## 6. Estado de implementación (2026-10)

Todos los pasos del plan original quedaron implementados y verificados con `tsc --noEmit --skipLibCheck` (solo quedan errores pre-existentes generados en `.next/types/routes.*`) y `npm run test:costing` (18 aserciones en verde).

1. ✅ **Migración** (`sql/global-config-pricing.sql`): se aplica en el arranque desde `src/lib/init-db.ts` (después de `schema.sql`; ignore si el archivo no existe en el build). Crea `configuracion_global` (fila `id=1` con CHECK), columnas de CPP/margen en `productos`, `producto_costos_historicos` y backfill único.
2. ✅ **Servicios**: `src/lib/global-config.ts` (lectura tipada; `getConfiguracionGlobal(client?)`; `monedaTransitoDe`) y `src/lib/costing.ts` (`contextoCotizacion` con tasas efectivas opcionales, `convertirConMetodo` directa/triangulación con fallback, `calcularCpp`, `precioVentaDesdeCosto`, `aplicarReglasRedondeo`, `procesarItemCompra` cascada + histórico, `ultimosCostosDeProducto`, `recomputarCppDesdeKardex`, `recalcularPreciosMasivo`).
3. ✅ **Guardar compra** (`src/app/api/compras/route.ts` POST): lee reglas globales dentro de la transacción, convierte cada costo a base según método global **respetando la tasa personalizada de la factura**, ejecuta `procesarItemCompra` (CPP + cascada + histórico) e inserta el kardex con `saldo_anterior/nuevo` y el mismo `costo_unit_base`.
4. ✅ **Anular compra** (DELETE): revierte stock, registra la salida `compra_anulada` y recomputa el CPP de cada producto con `recomputarCppDesdeKardex` (excluye por pareja Entrada+Anulación vía `referencia_id`).
5. ✅ **Ventas/reportes**: `ventas/route.ts` usa `costo_promedio_base` (con fallback legacy al `costo_base`) para el kardex de salida y de devolución; `reportes/route.ts` usa `COALESCE(NULLIF(p.costo_promedio_base,0), p.costo_base/TASA)` para valor de inventario, costo de lo vendido y ganancia bruta.
6. ✅ **Productos** (`src/app/api/productos/route.ts`): persiste `margen_ganancia`; el precio de venta se autocalcula (costo → moneda de venta × (1+margen%)) si no se envía; CPP inicial = costo del alta; GET expone `margen_ganancia`, `costo_promedio(_base)`, `precio_auto`, `precio_actualizado_en`.
7. ✅ **UI**:
   - `configuracion/page.tsx`: tarjeta "Motor de Precios (CPP)" → GET/PUT `api/configuracion-global` + botón "Recalcular" → POST `configuracion-global/recalcular-precios`.
   - `producto-modal.tsx`: campo "Margen de ganancia (%)" bidireccional (define→autocalcula precio; edita precio→recalcula margen), persistido en create/edit.
   - `compras/nueva/page.tsx`: autocompletado de costo por producto/moneda/presentación vía `GET api/compras/ultimos-costos` (`costoManual` editable).
8. ✅ **Endpoints nuevos**: `api/configuracion-global` (GET sesión / PUT admin), `api/configuracion-global/recalcular-precios` (admin), `api/compras/ultimos-costos` (sesión).
9. ✅ **Tests**: `tests/costing.ts` + `npm run test:costing` (usa `tests/paths-loader.mjs` → resuelve el alias `@/` en Node). `src/lib/global-config.ts` diferir el import de `@/lib/db` para mantener el núcleo puro.
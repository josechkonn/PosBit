export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-server";
import { query, queryOne, execute, transaction, registrarEliminacionSync } from "@/lib/db";
import { fechaLocalISO } from "@/lib/format";
import {
  aBase,
  redondear,
  tasaUsdDocumento,
  tasaMostrada,
  desdeBase,
  tasaUsd,
  monedaCostoDeProducto,
  aplicarDescuentosLinea,
  calcularTotalConDescuentos,
} from "@/lib/money";
import { getConfiguracionGlobal } from "@/lib/global-config";
import {
  contextoCotizacion,
  convertirConMetodo,
  procesarItemCompra,
  recomputarCppDesdeKardex,
} from "@/lib/costing";
import { triggerBackgroundSync } from "@/lib/sync-engine";

/** Error de validación de datos enviados por el cliente → HTTP 400. */
class ValidationError extends Error {}

function generarNumero() {
  const year = new Date().getFullYear();
  const random = Math.floor(Math.random() * 9000) + 1000;
  return `OC-${year}-${random}`;
}

export async function GET() {
  try {
    await requireSession();
    const [compras, items] = await Promise.all([
      query(`
        SELECT 
          c.*,
          p.nombre as proveedor_nombre,
          mo.codigo as moneda_codigo,
          mo.simbolo as moneda_simbolo,
          mp.nombre as metodo_pago_nombre,
          ca.nombre as caja_nombre,
          (SELECT COUNT(*) FROM compra_items WHERE compra_id = c.id) as items_count
        FROM compras c
        JOIN proveedores p ON c.proveedor_id = p.id
        JOIN monedas mo ON c.moneda_id = mo.id
        LEFT JOIN metodos_pago mp ON c.metodo_pago_id = mp.id
        LEFT JOIN cajas ca ON c.caja_id = ca.id
        ORDER BY c.fecha DESC, c.creado_en DESC, c.id DESC
      `),
      query(`
        SELECT ci.*, pr.nombre as producto_nombre, pr.codigo as producto_codigo
        FROM compra_items ci
        JOIN productos pr ON ci.producto_id = pr.id
        ORDER BY ci.compra_id, ci.id
      `),
    ]);

    return NextResponse.json({ compras, items });
  } catch (error) {
    return NextResponse.json({ error: "Error al obtener compras" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await requireSession();
    const body = await request.json();
    const { 
      proveedor_id, fecha, moneda_id, metodo_pago_id, caja_id, 
      items, observaciones, referencia, tasa: tasaCustom,
      // Nuevos campos para sistema de pagos/abonos
      tipo_pago,           // 'contado' | 'parcial' | 'credito'
      abono_inicial,       // number (monto en moneda de la compra) - solo para 'parcial'
      abono_moneda_id,     // moneda del abono inicial (default = moneda de la compra)
      // Descuento general de la factura (%) - se aplica sobre el neto de líneas
      descuento_general_pct,
    } = body;

    if (!proveedor_id || !moneda_id || !items || items.length === 0) {
      return NextResponse.json({ error: "Campos requeridos: proveedor_id, moneda_id, items" }, { status: 400 });
    }
    if (!tipo_pago || !['contado', 'parcial', 'credito'].includes(tipo_pago)) {
      return NextResponse.json({ error: "tipo_pago inválido: contado | parcial | credito" }, { status: 400 });
    }
    if (tipo_pago === 'parcial' && (!abono_inicial || Number(abono_inicial) <= 0)) {
      return NextResponse.json({ error: "abono_inicial requerido y > 0 para tipo_pago=parcial" }, { status: 400 });
    }

    const result = await transaction(async (client) => {
      const moneda = await client.query(`SELECT * FROM monedas WHERE id = $1`, [moneda_id]);
      if (moneda.rows.length === 0) {
        throw new ValidationError("Moneda no encontrada");
      }
      // Catálogo completo (incluso monedas inactivas): la cadena de conversiones
      // debe resolverse aunque una moneda del histórico esté desactivada
      const monedasCatalogo = (await client.query(`SELECT * FROM monedas`)).rows;
      const monedaCompra = moneda.rows[0];
      // Tasa efectiva de la compra: la personalizada si vino, si no la de la moneda
      const tasaUsdCompra = tasaUsdDocumento(monedaCompra, tasaCustom, monedasCatalogo);
      // Tasa "de cara al usuario": la personalizada si vino; si no, la directa a
      // USD cuando el modo directo está activo, o la de referencia en modo cadena.
      const tasaAplicada =
        tasaCustom !== null && tasaCustom !== undefined && Number(tasaCustom) > 0
          ? Number(tasaCustom)
          : tasaMostrada(monedaCompra);

      const decCompra = Number(monedaCompra.decimales ?? 2);

      // Reglas globales del motor (set & forget), leídas DENTRO de la
      // transacción: el operador jamás configura tasas/métodos por compra.
      const cfg = await getConfiguracionGlobal(client);
      const baseSistema = monedasCatalogo.find((m: any) => m.es_base) ?? monedasCatalogo[0];
      // La tasa personalizada de la factura (si la hay) se propaga al costeo:
      // el CPP debe consolidarse con la conversión REAL del documento.
      const ctxCompra = contextoCotizacion(cfg, "compras", monedasCatalogo, {
        [String(monedaCompra.id)]: tasaUsdCompra,
      });

      // ── Normalizar items ──────────────────────────────────────────────────
      // La UNIDAD es la fuente de verdad del sistema (stock/kardex pivotan en
      // unidades). Si el item viene con presentación, se desglosa:
      //   cantidad (unidades) = cantidad_presentaciones × unidades_presentación
      //   costo_unit           = costo_presentacion ÷ unidades_presentación
      //   subtotal (EXACTO)    = cantidad_presentaciones × costo_presentacion
      // así la factura refleja lo negociado al mayor (ej. "1 Caja de 24").
      //
      // DESCUENTOS: cada línea admite DOS descuentos % ENCADENADOS (el 2º sobre
      // el resultado del 1º) más un descuento GENERAL de la factura. El CPP se
      // alimenta del `costo_unit` NETO (ya descontado) para que el costo real
      // del inventario refleje lo que efectivamente se pagó.
      const itemsNormalizados: any[] = [];
      let subtotalTotal = 0;
      let descuentoLineasTotal = 0;

      for (const item of items) {
        // Margen de ganancia opcional por línea (el operador puede ajustarlo en
        // la compra). null = mantener el configurado en el producto.
        let margenN: number | null = null;
        if (item.margen != null) {
          const m = Number(item.margen);
          if (!Number.isFinite(m) || m < 0) {
            throw new ValidationError("Margen de ganancia inválido en un item del pedido");
          }
          margenN = m;
        }

        // ── Descuentos por línea (2 encadenados) ──
        const d1 = Number(item.descuento1_pct ?? 0) || 0;
        const d2 = Number(item.descuento2_pct ?? 0) || 0;
        if (d1 < 0 || d1 > 100 || d2 < 0 || d2 > 100) {
          throw new ValidationError("Los descuentos por línea deben estar entre 0 y 100 %");
        }

        if (item.presentacion_id) {
          const presRes = await client.query(
            `SELECT id, nombre, unidades, activo FROM producto_presentaciones WHERE id = $1 AND producto_id = $2`,
            [item.presentacion_id, item.producto_id]
          );
          if (presRes.rows.length === 0) {
            throw new ValidationError("La presentación seleccionada no existe para ese producto");
          }
          const pres = presRes.rows[0];
          const cantidadPres = parseInt(item.cantidad_presentaciones, 10);
          if (!Number.isInteger(cantidadPres) || cantidadPres <= 0) {
            throw new ValidationError(`Presentación "${pres.nombre}": la cantidad de presentaciones debe ser entera y mayor a 0`);
          }
          // Costo de la presentación: el negociado (o derivado del unitario si no vino)
          const costoPresN = Number(item.costo_presentacion);
          const costoPres = Number.isFinite(costoPresN) && costoPresN > 0
            ? redondear(costoPresN, decCompra)
            : redondear(Number(item.costo_unit || 0) * Number(pres.unidades), decCompra);

          const cantidadUnidades = Number(pres.unidades) * cantidadPres;
          const costoUnit = redondear(costoPres / Number(pres.unidades), decCompra);

          // Descuentos encadenados sobre el bruto de la línea (lista × cantidad)
          const dsc = aplicarDescuentosLinea(costoUnit, cantidadUnidades, d1, d2, decCompra);

          itemsNormalizados.push({
            ...item,
            cantidad: cantidadUnidades,
            costo_unit: costoUnit,
            // El costo que alimenta el CPP es el NETO (lo realmente pagado)
            costo_unit_neto: dsc.costoUnitNeto,
            margen: margenN,
            subtotal: dsc.subtotalNeto,
            subtotal_bruto: dsc.subtotalBruto,
            descuento_monto: dsc.descuentoTotalMonto,
            _d1: d1,
            _d2: d2,
            _presentacion: {
              id: String(pres.id),
              nombre: pres.nombre,
              unidades: Number(pres.unidades),
              cantidad_presentaciones: cantidadPres,
              costo_presentacion: redondear(dsc.costoUnitNeto * Number(pres.unidades), decCompra),
              costo_presentacion_bruto: costoPres,
            },
          });
        } else {
          const cantidad = parseInt(item.cantidad, 10);
          if (!Number.isInteger(cantidad) || cantidad <= 0) {
            throw new ValidationError("Cantidad inválida en un item del pedido");
          }
          const costoUnit = Number(item.costo_unit);
          if (!Number.isFinite(costoUnit) || costoUnit < 0) {
            throw new ValidationError("Costo unitario inválido en un item del pedido");
          }

          const dsc = aplicarDescuentosLinea(costoUnit, cantidad, d1, d2, decCompra);

          itemsNormalizados.push({
            ...item,
            cantidad,
            costo_unit: redondear(costoUnit, decCompra),
            costo_unit_neto: dsc.costoUnitNeto,
            margen: margenN,
            subtotal: dsc.subtotalNeto,
            subtotal_bruto: dsc.subtotalBruto,
            descuento_monto: dsc.descuentoTotalMonto,
            _d1: d1,
            _d2: d2,
            _presentacion: null,
          });
        }
        const ultimo = itemsNormalizados[itemsNormalizados.length - 1];
        subtotalTotal += ultimo.subtotal;
        descuentoLineasTotal += ultimo.descuento_monto;
      }
      subtotalTotal = redondear(subtotalTotal, decCompra);
      descuentoLineasTotal = redondear(descuentoLineasTotal, decCompra);

      // ── Descuento GENERAL de la factura (sobre el neto de las líneas) ──────
      const dgPct = Number(descuento_general_pct ?? 0) || 0;
      if (dgPct < 0 || dgPct > 100) {
        throw new ValidationError("El descuento general debe estar entre 0 y 100 %");
      }
      const resumen = calcularTotalConDescuentos([subtotalTotal], dgPct, decCompra);
      const descuentoGeneralMonto = resumen.descuentoGeneralMonto;
      // `subtotalTotal` = neto de líneas (ya con sus descuentos por línea)
      // `total`         = neto de líneas − descuento general
      const totalFinal = resumen.total;

      // `total_base` siempre en USD, usando la tasa efectiva del documento
      const totalBase = aBase(totalFinal, tasaUsdCompra);

      // ── Calcular estado_pago y saldo_pendiente según tipo_pago ────────────────────
      let estadoPago: 'pagado' | 'parcial' | 'pendiente';
      let saldoPendienteBase: number;

      if (tipo_pago === 'contado') {
        estadoPago = 'pagado';
        saldoPendienteBase = 0;
      } else if (tipo_pago === 'credito') {
        estadoPago = 'pendiente';
        saldoPendienteBase = totalBase;
      } else { // 'parcial'
        estadoPago = 'parcial';
        // El abono_inicial viene en moneda de la compra (default) o en abono_moneda_id
        const abonoMonedaId = abono_moneda_id || moneda_id;
        const abonoMoneda = monedasCatalogo.find((m: any) => String(m.id) === String(abonoMonedaId)) || monedaCompra;
        // Tasa de cambio del abono (unidades de abonoMoneda por 1 USD)
        const tasaAbono = tasaUsdDocumento(abonoMoneda, null, monedasCatalogo); // si no hay tasa custom, usa la de la moneda
        const abonoBase = aBase(Number(abono_inicial), tasaAbono);
        saldoPendienteBase = Math.max(totalBase - abonoBase, 0);
      }

      const compraRes = await client.query(
        `INSERT INTO compras (numero, proveedor_id, fecha, moneda_id, metodo_pago_id, caja_id, subtotal, total, total_base, tasa, estado, observaciones, referencia, estado_pago, saldo_pendiente, descuento_pct, descuento_monto)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         RETURNING *`,
        [
          generarNumero(),
          proveedor_id,
          fecha || fechaLocalISO(),
          moneda_id,
          metodo_pago_id || null,
          caja_id || null,
          subtotalTotal,          // neto de líneas (ya descontadas por ítem)
          totalFinal,             // neto − descuento general
          totalBase,
          tasaAplicada,
          "Recibida",
          observaciones || null,
          referencia || null,
          estadoPago,
          saldoPendienteBase,
          dgPct,
          descuentoGeneralMonto,
        ]
      );

      const compra = compraRes.rows[0];

      // ── Si es parcial, crear abono inicial ───────────────────────────────────
      if (tipo_pago === 'parcial') {
        const abonoMonedaId = abono_moneda_id || moneda_id;
        const abonoMoneda = monedasCatalogo.find((m: any) => String(m.id) === String(abonoMonedaId)) || monedaCompra;
        const tasaAbono = tasaUsdDocumento(abonoMoneda, null, monedasCatalogo);
        const abonoBase = aBase(Number(abono_inicial), tasaAbono);

        await client.query(
          `INSERT INTO compra_abonos (compra_id, fecha, monto, moneda_id, tasa_cambio, monto_base, metodo_pago_id, caja_id, observaciones)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [compra.id, fecha || fechaLocalISO(), Number(abono_inicial), abonoMonedaId, tasaAbono, abonoBase, metodo_pago_id || null, caja_id || null, `Abono inicial de compra ${compra.numero}`]
        );
      }

      for (const item of itemsNormalizados) {
        // Costo unitario NETO (ya descontado por los 2 % de la línea) → moneda base
        // (USD) según el MÉTODO GLOBAL de compras (directa | triangulación).
        // Es lo que realmente se pagó, así que es lo que debe entrar al CPP.
        const costoUnitNeto = item.costo_unit_neto ?? item.costo_unit;
        const costoUnitBase = convertirConMetodo(costoUnitNeto, monedaCompra, baseSistema, ctxCompra, 6);

        // CPP + efecto cascada de precios + histórico de costos. Actualiza en
        // el producto: stock, costo_promedio(_base) y, si el toggle está on,
        // precio_base = CPP × (1 + margen%) con redondeo global.
        const cascada = await procesarItemCompra(client, {
          item: { ...item, costo_unit_base: costoUnitBase },
          compraId: compra.id,
          compraNumero: compra.numero,
          monedaCompra,
          monedasCatalogo,
          baseSistema,
          cfg,
          ctxCompra,
        });

        const subtotalItem = item.subtotal;
        const subtotalBase = aBase(subtotalItem, tasaUsdCompra);
        const pres = item._presentacion;

        await client.query(
          `INSERT INTO compra_items (compra_id, producto_id, cantidad, costo_unit, costo_unit_base, subtotal, subtotal_base, presentacion_id, presentacion_nombre, presentacion_unidades, cantidad_presentaciones, costo_presentacion, descuento1_pct, descuento2_pct, subtotal_bruto, descuento_monto)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
          [
            compra.id,
            item.producto_id,
            item.cantidad,
            item.costo_unit,
            costoUnitBase,
            subtotalItem,
            subtotalBase,
            pres?.id ?? null,
            pres?.nombre ?? null,
            pres?.unidades ?? null,
            pres?.cantidad_presentaciones ?? null,
            pres?.costo_presentacion ?? null,
            item._d1 ?? 0,
            item._d2 ?? 0,
            item.subtotal_bruto ?? subtotalItem,
            item.descuento_monto ?? 0,
          ]
        );

        // El kardex guarda el costo en la moneda de COMPRA del producto (y su
        // equivalente USD). El `costo_unit_base` es la MISMA fuente que el CPP:
        // así el replay de kardex (`recomputarCppDesdeKardex`) es consistente.
        const monedaCosto = cascada.monedaCosto;
        const decCostoProd = Number(monedaCosto.decimales ?? 2);
        const tasaUsdCosto = tasaUsd(monedaCosto, monedasCatalogo);
        const costoUnitProducto = redondear(desdeBase(costoUnitBase, tasaUsdCosto, 6), decCostoProd);
        await client.query(
          `INSERT INTO kardex (producto_id, fecha, tipo, motivo, referencia_tipo, referencia_id, cantidad, costo_unit, costo_unit_base, saldo_anterior, saldo_actual) 
           VALUES ($1, NOW(), 'Entrada', $2, 'compra', $3, $4, $5, $6, $7, $8)`,
          [item.producto_id, `Compra ${compra.numero}`, compra.id, item.cantidad, costoUnitProducto, costoUnitBase, cascada.stock_anterior, cascada.stock_nuevo]
        );
      }

      // ── Movimiento de caja / transacción según tipo_pago ─────────────────────
      if (caja_id && metodo_pago_id) {
        let montoCaja = 0;
        let montoBaseCaja = 0;
        let monedaCaja = moneda_id;
        let tasaCaja = tasaAplicada;
        let descripcionCaja = `Pago compra ${compra.numero}`;

        if (tipo_pago === 'contado') {
          // Se cobra el TOTAL final (neto de líneas − descuento general)
          montoCaja = totalFinal;
          montoBaseCaja = totalBase;
        } else if (tipo_pago === 'parcial') {
          const abonoMonedaId = abono_moneda_id || moneda_id;
          const abonoMoneda = monedasCatalogo.find((m: any) => String(m.id) === String(abono_moneda_id || moneda_id)) || monedaCompra;
          const tasaAbono = tasaUsdDocumento(abonoMoneda, null, monedasCatalogo);
          montoCaja = Number(abono_inicial);
          montoBaseCaja = aBase(Number(abono_inicial), tasaUsdDocumento(monedasCatalogo.find((m: any) => String(m.id) === String(abono_moneda_id || moneda_id)) || monedaCompra, null, monedasCatalogo));
          monedaCaja = abono_moneda_id || moneda_id;
          tasaCaja = tasaUsdDocumento(monedasCatalogo.find((m: any) => String(m.id) === String(abono_moneda_id || moneda_id)) || monedaCompra, null, monedasCatalogo);
          descripcionCaja = `Abono inicial compra ${compra.numero}`;
        }
        // 'credito' → no hay movimiento de caja al crear la compra

        if (montoCaja > 0) {
          await client.query(
            `INSERT INTO transacciones (caja_id, fecha, tipo, monto, moneda_id, monto_base, tasa, descripcion, referencia_tipo, referencia_id) 
             VALUES ($1, NOW(), 'Salida', $2, $3, $4, $5, $6, 'compra', $7)`,
            [caja_id, montoCaja, monedaCaja, montoBaseCaja, tasaCaja, descripcionCaja, compra.id]
          );

          await client.query(
            `UPDATE cajas SET saldo_actual = saldo_actual - $1 WHERE id = $2`,
            [montoBaseCaja, caja_id]
          );
        }
      }

      return compra;
    });

    triggerBackgroundSync();
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Error al crear compra:", error);
    return NextResponse.json({ error: "Error al crear compra" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    await requireSession();
    const body = await request.json();
    const { id, estado, observaciones } = body;

    if (!id) {
      return NextResponse.json({ error: "ID requerido" }, { status: 400 });
    }

    const result = await queryOne(
      `UPDATE compras 
       SET estado = COALESCE($2, estado), 
           observaciones = COALESCE($3, observaciones)
       WHERE id = $1 
       RETURNING *`,
      [id, estado, observaciones]
    );

    if (!result) {
      return NextResponse.json({ error: "Compra no encontrada" }, { status: 404 });
    }

    triggerBackgroundSync();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: "Error al actualizar compra" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    await requireSession();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "ID requerido" }, { status: 400 });
    }

    await transaction(async (client) => {
      const compra = await client.query(`SELECT * FROM compras WHERE id = $1`, [id]);
      if (compra.rows.length === 0) {
        throw new Error("Compra no encontrada");
      }

      const items = await client.query(`SELECT * FROM compra_items WHERE compra_id = $1`, [id]);
      // Catálogo completo (incluso monedas inactivas): la cadena de conversiones
      // debe resolverse aunque una moneda del histórico esté desactivada
      const monedasCatalogo = (await client.query(`SELECT * FROM monedas`)).rows;
      const monedaCompra =
        monedasCatalogo.find((m: any) => String(m.id) === String(compra.rows[0].moneda_id)) || monedasCatalogo[0];

      for (const item of items.rows) {
        const productoActual = await client.query(`SELECT * FROM productos WHERE id = $1`, [item.producto_id]);
        const stockAnterior = productoActual.rows[0]?.stock || 0;
        const nuevoStock = Math.max(0, stockAnterior - item.cantidad);

        await client.query(`UPDATE productos SET stock = $1 WHERE id = $2`, [nuevoStock, item.producto_id]);

        // El costo de la anulación se revierte desde la base guardada en la compra
        // original (costo_unit_base → moneda de COMPRA actual del producto):
        // mismo valor que la entrada que se está anulando.
        const monedaCosto = monedaCostoDeProducto(productoActual.rows[0], monedaCompra, monedasCatalogo);
        const costoUnitBase = Number(item.costo_unit_base) || 0;
        const decCostoProd = Number(monedaCosto.decimales ?? 2);
        const costoUnitProducto = redondear(desdeBase(costoUnitBase, tasaUsd(monedaCosto, monedasCatalogo), 6), decCostoProd);
        const costoUnitUsd = costoUnitBase;
        await client.query(
          `INSERT INTO kardex (producto_id, fecha, tipo, motivo, referencia_tipo, referencia_id, cantidad, costo_unit, costo_unit_base, saldo_anterior, saldo_actual) 
           VALUES ($1, NOW(), 'Salida', $2, 'compra_anulada', $3, $4, $5, $6, $7, $8)`,
          [item.producto_id, `Anulación compra`, id, item.cantidad, costoUnitProducto, costoUnitUsd, stockAnterior, nuevoStock]
        );
      }

      // Recomponer el CPP desde kardex: la anulación no es reversible por
      // álgebra (el costo ya se fusionó al promedio). Se excluyen por pareja
      // (Entrada 'Compra X' + Salida 'compra_anulada') y se re-promedia el resto.
      const baseSistema = monedasCatalogo.find((m: any) => m.es_base) ?? monedasCatalogo[0];
      const productoIds = Array.from(new Set(items.rows.map((i: any) => i.producto_id))) as number[];
      for (const pid of productoIds) {
        await recomputarCppDesdeKardex(client, pid, monedasCatalogo, baseSistema);
      }

      await client.query(`DELETE FROM compra_items WHERE compra_id = $1`, [id]);
      await client.query(`DELETE FROM compras WHERE id = $1`, [id]);
      await registrarEliminacionSync("compras", id, client);
    });

    triggerBackgroundSync();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Error al eliminar compra" }, { status: 500 });
  }
}

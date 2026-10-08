export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-server";
import { query, queryOne, execute, transaction } from "@/lib/db";
import { aBase, convertir, redondear, tasaUsd, tasaUsdDocumento, monedaDeProducto } from "@/lib/money";

function generarNumero() {
  const year = new Date().getFullYear();
  const random = Math.floor(Math.random() * 9000) + 1000;
  return `VTA-${year}-${random}`;
}

function generarNumeroCredito() {
  const year = new Date().getFullYear();
  const random = Math.floor(Math.random() * 9000) + 1000;
  return `CRE-${year}-${random}`;
}

export async function GET() {
  try {
    await requireSession();
    const ventas = await query(`
      SELECT 
        v.*,
        cl.nombre as cliente_nombre,
        mo.codigo as moneda_codigo,
        mo.simbolo as moneda_simbolo,
        mp.nombre as metodo_pago_nombre,
        ca.nombre as caja_nombre,
        (SELECT COUNT(*) FROM venta_items WHERE venta_id = v.id) as items_count,
        cr.id as credito_id,
        cr.numero as credito_numero,
        cr.monto_total as credito_monto_total,
        cr.saldo as credito_saldo,
        cr.estado as credito_estado
      FROM ventas v
      LEFT JOIN clientes cl ON v.cliente_id = cl.id
      JOIN monedas mo ON v.moneda_id = mo.id
      LEFT JOIN metodos_pago mp ON v.metodo_pago_id = mp.id
      LEFT JOIN cajas ca ON v.caja_id = ca.id
      LEFT JOIN creditos cr ON cr.venta_id = v.id
      ORDER BY v.fecha DESC, v.id DESC
    `);

    const items = await query(`
      SELECT vi.*, pr.nombre as producto_nombre, pr.codigo as producto_codigo
      FROM venta_items vi
      JOIN productos pr ON vi.producto_id = pr.id
      ORDER BY vi.venta_id, vi.id
    `);

    // Líneas de pago por venta (pago mixto en varias monedas)
    const pagos = await query(`
      SELECT vp.*, mp.nombre as metodo_pago_nombre, mo.codigo as moneda_codigo, mo.simbolo as moneda_simbolo, mo.decimales as moneda_decimales
      FROM venta_pagos vp
      LEFT JOIN metodos_pago mp ON vp.metodo_pago_id = mp.id
      JOIN monedas mo ON vp.moneda_id = mo.id
      ORDER BY vp.venta_id, vp.id
    `);
    const pagosPorVenta = new Map<number, typeof pagos>();
    for (const p of pagos) {
      const lista = pagosPorVenta.get(p.venta_id) || [];
      lista.push(p);
      pagosPorVenta.set(p.venta_id, lista);
    }
    const ventasConPagos = ventas.map((v) => ({ ...v, pagos: pagosPorVenta.get(v.id) || [] }));

    return NextResponse.json({ ventas: ventasConPagos, items });
  } catch (error) {
    return NextResponse.json({ error: "Error al obtener ventas" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await requireSession();
    const body = await request.json();
    const { cliente, cliente_id, tipo_pago, fecha, moneda_id, metodo_pago_id, caja_id, items, observaciones, descuento = 0, tasa: tasaCustom, monto_pagado, pagos } = body;

    if (!moneda_id || !items || items.length === 0) {
      return NextResponse.json({ error: "Campos requeridos: moneda_id, items" }, { status: 400 });
    }

    // `pagos` (opcional): líneas de pago mixto, cada una con su método/moneda.
    // Sin `pagos` se comporta como antes: `monto_pagado` si viene; si no,
    // crédito = nada pagado y contado = total pagado.
    const lineasPagoReq = Array.isArray(pagos) && pagos.length > 0 ? pagos : null;
    const esCreditoSolicitado = tipo_pago === "Credito" || tipo_pago === "Crédito";

    const result = await transaction(async (client) => {
      const moneda = await client.query(`SELECT * FROM monedas WHERE id = $1`, [moneda_id]);
      if (moneda.rows.length === 0) {
        throw new Error("Moneda no encontrada");
      }
      // Catálogo completo (incluso monedas inactivas): la cadena de conversiones
      // debe resolverse aunque una moneda del histórico esté desactivada
      const monedasCatalogo = (await client.query(`SELECT * FROM monedas`)).rows;
      const monedaVenta = moneda.rows[0];
      // Tasa efectiva para el pase a base (USD): la personalizada si vino, si no la de la moneda
      const tasaUsdVenta = tasaUsdDocumento(monedaVenta, tasaCustom, monedasCatalogo);
      // Tasa "de cara al usuario" (unidades de la moneda por su referencia): la que se guarda
      const tasaAplicada =
        tasaCustom !== null && tasaCustom !== undefined && Number(tasaCustom) > 0
          ? Number(tasaCustom)
          : Number(monedaVenta.tasa);

      let clienteNombre = cliente || null;
      let clienteRow = null;
      if (cliente_id) {
        const clienteRes = await client.query(`SELECT * FROM clientes WHERE id = $1`, [cliente_id]);
        if (clienteRes.rows.length === 0) {
          throw new Error("Cliente no encontrado");
        }
        clienteRow = clienteRes.rows[0];
        clienteNombre = clienteRow.nombre;
      }

      // El método de pago se guarda en la venta; en crédito no mueve dinero de la caja
      let metodoRow: any = null;
      if (metodo_pago_id) {
        const metodoRes = await client.query(
          `SELECT mp.*, ca.moneda_id as caja_moneda_id
           FROM metodos_pago mp
           LEFT JOIN cajas ca ON mp.caja_id = ca.id
           WHERE mp.id = $1`,
          [metodo_pago_id]
        );
        if (metodoRes.rows.length === 0) {
          throw new Error("Método de pago no encontrado");
        }
        metodoRow = metodoRes.rows[0];
      }

      let subtotalTotal = 0;
      let impuestoTotal = 0;

      for (const item of items) {
        const producto = await client.query(`SELECT * FROM productos WHERE id = $1`, [item.producto_id]);
        if (producto.rows.length === 0) {
          throw new Error(`Producto ${item.producto_id} no encontrado`);
        }
        if (producto.rows[0].stock < item.cantidad) {
          throw new Error(`Existencias insuficientes para ${producto.rows[0].nombre}`);
        }
        // Sin precio enviado, se toma el precio_base del producto (en SU moneda)
        // y se convierte a la moneda de la venta
        if (item.precio_unit === null || item.precio_unit === undefined) {
          const monedaProducto = monedaDeProducto(producto.rows[0], monedaVenta, monedasCatalogo);
          item.precio_unit = convertir(
            Number(producto.rows[0].precio_base),
            monedaProducto,
            monedaVenta,
            monedasCatalogo,
            Number(monedaVenta.decimales ?? 2)
          );
        }
        const lineTotal = item.cantidad * item.precio_unit;
        subtotalTotal += lineTotal;
        if (!producto.rows[0].iva_incluido) {
          impuestoTotal += Math.round(lineTotal * 0.16 * 100) / 100;
        }
      }

      const total = Math.max(0, subtotalTotal - descuento + impuestoTotal);
      // `*_base` siempre en USD, usando la tasa efectiva del documento
      const totalBase = aBase(total, tasaUsdVenta);
      const descuentoBase = aBase(descuento, tasaUsdVenta);

      // ── Pago: cuánto aplica a esta venta y cuánto queda como deuda ──
      // Con `pagos` (pago mixto) cada línea se convierte a la moneda de la
      // venta con la tasa efectiva del documento; lo que sobra de una línea se
      // devuelve como vuelto en SU moneda. Sin `pagos`: `monto_pagado` si viene
      // (pago parcial); si no, crédito = 0 pagado y contado = total pagado.
      interface LineaPagoResuelta {
        metodoId: number;
        cajaId: number;
        monedaId: number;
        tasaUsdLinea: number; // unidades de la moneda del método por 1 USD
        monto: number; // entregado en la moneda del método
        montoAplicado: number; // aplicado a la venta (moneda de la venta)
        vuelto: number; // devuelto en la moneda del método
        montoBase: number; // entregado en USD
      }
      const lineasPago: LineaPagoResuelta[] = [];
      let pagado = 0; // en moneda de la venta
      let deuda = total; // en moneda de la venta

      if (lineasPagoReq) {
        let restante = redondear(total);
        for (const p of lineasPagoReq) {
          const montoLinea = redondear(Number(p?.monto));
          if (!p?.metodo_pago_id || !Number.isFinite(montoLinea) || montoLinea <= 0) continue;

          const metRes = await client.query(
            `SELECT mp.id, mp.nombre, mp.caja_id, ca.moneda_id
             FROM metodos_pago mp
             LEFT JOIN cajas ca ON mp.caja_id = ca.id
             WHERE mp.id = $1`,
            [p.metodo_pago_id]
          );
          if (metRes.rows.length === 0) {
            throw new Error("Método de pago no encontrado");
          }
          const met = metRes.rows[0];
          if (!met.caja_id || !met.moneda_id) {
            throw new Error(`El método de pago "${met.nombre}" no tiene una caja asignada`);
          }
          const monedaLinea = monedasCatalogo.find((m: any) => Number(m.id) === Number(met.moneda_id));
          if (!monedaLinea) {
            throw new Error("Moneda del método de pago no encontrada");
          }
          const tasaUsdLinea = tasaUsd(monedaLinea, monedasCatalogo);
          const esMonedaVenta = Number(met.moneda_id) === Number(moneda_id);

          // Entregado → moneda de la venta (vía USD con la tasa del documento)
          const montoVenta = esMonedaVenta
            ? montoLinea
            : redondear((montoLinea / tasaUsdLinea) * tasaUsdVenta);
          const aplicado = Math.min(montoVenta, restante);
          // Lo aplicado → moneda del método, para saber el vuelto y lo que entra a la caja
          const aplicadoLinea = esMonedaVenta
            ? aplicado
            : redondear((aplicado / tasaUsdVenta) * tasaUsdLinea);
          const vuelto = redondear(Math.max(0, montoLinea - aplicadoLinea));

          restante = redondear(restante - aplicado);
          pagado = redondear(pagado + aplicado);
          lineasPago.push({
            metodoId: Number(met.id),
            cajaId: Number(met.caja_id),
            monedaId: Number(met.moneda_id),
            tasaUsdLinea,
            monto: montoLinea,
            montoAplicado: aplicado,
            vuelto,
            montoBase: aBase(montoLinea, tasaUsdLinea),
          });
        }
        deuda = restante;
      } else {
        pagado =
          monto_pagado !== undefined && monto_pagado !== null && Number.isFinite(Number(monto_pagado))
            ? Math.min(Math.max(0, Number(monto_pagado)), total)
            : esCreditoSolicitado
              ? 0
              : total;
        deuda = Math.max(0, Math.round((total - pagado) * 100) / 100);
      }

      const pagadoBase = aBase(pagado, tasaUsdVenta);
      const deudaBase = aBase(deuda, tasaUsdVenta);
      // Lo que falta por pagar convierte la venta en crédito (parcial o total)
      const esCredito = deuda > 0.009;

      // El efectivo que de verdad entra por cada línea (entregado − vuelto)
      const efectivoLinea = (l: LineaPagoResuelta) => redondear(Math.max(0, l.monto - l.vuelto));

      // Con pago mixto la venta hereda método/caja de la primera línea con
      // efectivo (si el cliente no envió uno explícito)
      const primeraConEfectivo = lineasPago.find((l) => efectivoLinea(l) > 0.009);
      const metodoVentaId = metodo_pago_id || primeraConEfectivo?.metodoId || null;
      const cajaVentaId =
        pagado > 0.009 ? (caja_id || primeraConEfectivo?.cajaId || null) : null;

      if (esCredito) {
        if (!clienteRow) {
          throw new Error("Seleccione un cliente para la venta a crédito");
        }
        if (!clienteRow.recibe_credito) {
          throw new Error(`${clienteRow.nombre} no tiene crédito habilitado`);
        }
        // El crédito se hace en la moneda de la venta (USD, VES o COP) y el
        // método de pago debe estar en esa misma moneda
        if (!metodoRow) {
          throw new Error("Seleccione el método de pago de la venta a crédito");
        }
        if (!metodoRow.caja_moneda_id) {
          throw new Error("El método de pago seleccionado no tiene una caja asignada");
        }
        if (Number(metodoRow.caja_moneda_id) !== Number(moneda_id)) {
          throw new Error("El método de pago debe tener la misma moneda que el crédito");
        }

        // Límite de crédito por moneda: 0 = sin crédito en esa moneda.
        // Se valida contra la deuda que queda (total − pago inicial).
        const codigoMoneda = String(moneda.rows[0].codigo || "").toUpperCase();
        const limiteRes = await client.query(
          `SELECT limite FROM cliente_limites_credito WHERE cliente_id = $1 AND moneda_id = $2`,
          [cliente_id, moneda_id]
        );
        const limiteMoneda = parseFloat(limiteRes.rows[0]?.limite || "0");
        if (limiteMoneda <= 0) {
          throw new Error(`${clienteRow.nombre} no tiene crédito habilitado en ${codigoMoneda}`);
        }

        const deudaRes = await client.query(
          `SELECT COALESCE(SUM(saldo), 0) as deuda FROM creditos
           WHERE cliente_id = $1 AND moneda_id = $2 AND estado <> 'Pagado'`,
          [cliente_id, moneda_id]
        );
        const deudaMoneda = parseFloat(deudaRes.rows[0]?.deuda || "0");
        if (deudaMoneda + deuda > limiteMoneda) {
          throw new Error(
            `Supera el límite de crédito en ${codigoMoneda}: deuda ${deudaMoneda.toFixed(2)} + pendiente ${deuda.toFixed(2)} > límite ${limiteMoneda.toFixed(2)}`
          );
        }
      }

      const estadoVenta = esCredito ? "Credito" : "Pagada";

      const ventaRes = await client.query(
        `INSERT INTO ventas (numero, cliente, cliente_id, tipo_pago, fecha, moneda_id, metodo_pago_id, caja_id, subtotal, descuento, impuesto, total, total_base, descuento_base, tasa, estado, observaciones) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) 
         RETURNING *`,
         [generarNumero(), clienteNombre, cliente_id || null, esCredito ? "Credito" : "Contado", fecha || new Date().toISOString().split("T")[0], moneda_id, metodoVentaId, cajaVentaId, subtotalTotal, descuento, impuestoTotal, total, totalBase, descuentoBase, tasaAplicada, estadoVenta, observaciones || null]
      );

      const venta = ventaRes.rows[0];

      // Cada línea de pago queda registrada en su moneda (pago mixto)
      for (const l of lineasPago) {
        const tasaLinea = l.montoAplicado > 0 ? redondear(l.monto / l.montoAplicado, 6) : null;
        await client.query(
          `INSERT INTO venta_pagos (venta_id, metodo_pago_id, moneda_id, monto, monto_base, monto_aplicado, vuelto, tasa)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [venta.id, l.metodoId, l.monedaId, l.monto, l.montoBase, l.montoAplicado, l.vuelto, tasaLinea]
        );
      }

      for (const item of items) {
        const producto = await client.query(`SELECT * FROM productos WHERE id = $1`, [item.producto_id]);
        const monedaProducto = monedaDeProducto(producto.rows[0], monedaVenta, monedasCatalogo);
        const precioUnitBase = aBase(item.precio_unit, tasaUsdVenta);
        const subtotalItem = item.cantidad * item.precio_unit;
        const subtotalBase = aBase(subtotalItem, tasaUsdVenta);

        await client.query(
          `INSERT INTO venta_items (venta_id, producto_id, cantidad, precio_unit, precio_unit_base, subtotal, subtotal_base) 
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [venta.id, item.producto_id, item.cantidad, item.precio_unit, precioUnitBase, subtotalItem, subtotalBase]
        );

        const stockAnterior = producto.rows[0].stock;
        const nuevoStock = stockAnterior - item.cantidad;

        await client.query(
          `UPDATE productos SET stock = $1 WHERE id = $2`,
          [nuevoStock, item.producto_id]
        );

        // El kardex guarda el costo en la moneda del producto y su equivalente USD
        const costoProducto = Number(producto.rows[0].costo_base) || 0;
        const costoUsd = aBase(costoProducto, tasaUsd(monedaProducto, monedasCatalogo));
        await client.query(
          `INSERT INTO kardex (producto_id, fecha, tipo, motivo, referencia_tipo, referencia_id, cantidad, costo_unit, costo_unit_base, saldo_anterior, saldo_actual) 
           VALUES ($1, NOW(), 'Salida', $2, 'venta', $3, $4, $5, $6, $7, $8)`,
          [item.producto_id, `Venta ${venta.numero}`, venta.id, item.cantidad, costoProducto, costoUsd, stockAnterior, nuevoStock]
        );
      }

      if (esCredito) {
        // El crédito queda en la moneda de la venta (USD, VES o COP):
        // monto_total = total de la venta, saldo = lo que falta por pagar.
        // 'Parcial' cuando ya se recibió un pago inicial, 'Pendiente' si no.
        const creditoRes = await client.query(
          `INSERT INTO creditos (numero, cliente_id, venta_id, fecha, monto_total, saldo, estado, moneda_id, total_base, saldo_base) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) 
           RETURNING id`,
          [generarNumeroCredito(), cliente_id, venta.id, venta.fecha, total, deuda, pagado > 0.009 ? "Parcial" : "Pendiente", moneda_id, deudaBase]
        );

        // El pago inicial queda registrado como abono contra ese crédito
        if (pagado > 0.009) {
          if (lineasPago.length > 0) {
            // Pago mixto: un abono por cada línea, en la moneda de esa línea
            for (const l of lineasPago) {
              const efectivo = efectivoLinea(l);
              if (efectivo <= 0.009) continue;
              await client.query(
                `INSERT INTO abonos (credito_id, cliente_id, retorno_id, fecha, monto, moneda_id, monto_base, metodo_pago_id, caja_id, observaciones)
                 VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $9)`,
                [creditoRes.rows[0].id, cliente_id, venta.fecha, efectivo, l.monedaId, aBase(efectivo, l.tasaUsdLinea), l.metodoId, l.cajaId, `Pago inicial venta ${venta.numero}`]
              );
            }
          } else {
            await client.query(
              `INSERT INTO abonos (credito_id, cliente_id, retorno_id, fecha, monto, moneda_id, monto_base, metodo_pago_id, caja_id, observaciones)
               VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $9)`,
              [creditoRes.rows[0].id, cliente_id, venta.fecha, pagado, moneda_id, pagadoBase, metodo_pago_id || null, caja_id || null, `Pago inicial venta ${venta.numero}`]
            );
          }
        }
      }

      // Dinero que entra a la caja: una transacción por línea, en la moneda de
      // esa línea (el vuelto nunca entra a la caja)
      const entradasCaja: { cajaId: number; monto: number; monedaId: number; montoBase: number; tasa: number }[] = [];
      if (lineasPago.length > 0) {
        for (const l of lineasPago) {
          const efectivo = efectivoLinea(l);
          if (efectivo <= 0.009) continue;
          entradasCaja.push({
            cajaId: l.cajaId,
            monto: efectivo,
            monedaId: l.monedaId,
            montoBase: aBase(efectivo, l.tasaUsdLinea),
            tasa: Number(monedasCatalogo.find((m: any) => Number(m.id) === l.monedaId)?.tasa) || 1,
          });
        }
      } else if (caja_id && metodo_pago_id && pagado > 0.009) {
        entradasCaja.push({ cajaId: Number(caja_id), monto: pagado, monedaId: Number(moneda_id), montoBase: pagadoBase, tasa: tasaAplicada });
      }

      for (const e of entradasCaja) {
        await client.query(
          `INSERT INTO transacciones (caja_id, fecha, tipo, monto, moneda_id, monto_base, tasa, descripcion, referencia_tipo, referencia_id) 
           VALUES ($1, NOW(), 'Entrada', $2, $3, $4, $5, $6, 'venta', $7)`,
          [e.cajaId, e.monto, e.monedaId, e.montoBase, e.tasa, `Cobro venta ${venta.numero}`, venta.id]
        );

        await client.query(
          `UPDATE cajas SET saldo_actual = saldo_actual + $1 WHERE id = $2`,
          [e.monto, e.cajaId]
        );
      }

      return venta;
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error al crear venta" }, { status: 500 });
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
      `UPDATE ventas 
       SET estado = COALESCE($2, estado), 
           observaciones = COALESCE($3, observaciones)
       WHERE id = $1 
       RETURNING *`,
      [id, estado, observaciones]
    );

    if (!result) {
      return NextResponse.json({ error: "Venta no encontrada" }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: "Error al actualizar venta" }, { status: 500 });
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
      const venta = await client.query(`SELECT * FROM ventas WHERE id = $1`, [id]);
      if (venta.rows.length === 0) {
        throw new Error("Venta no encontrada");
      }

      if (venta.rows[0].estado === "Credito") {
        const abonosRes = await client.query(
          `SELECT COUNT(*) as count FROM abonos WHERE credito_id IN (SELECT id FROM creditos WHERE venta_id = $1)`,
          [id]
        );
        if (parseInt(abonosRes.rows[0]?.count || "0", 10) > 0) {
          throw new Error("No se puede eliminar: la venta a crédito tiene abonos registrados");
        }
      }

      const items = await client.query(`SELECT * FROM venta_items WHERE venta_id = $1`, [id]);
      // Catálogo completo (incluso monedas inactivas): la cadena de conversiones
      // debe resolverse aunque una moneda del histórico esté desactivada
      const monedasCatalogo = (await client.query(`SELECT * FROM monedas`)).rows;
      const monedaVenta =
        monedasCatalogo.find((m: any) => Number(m.id) === Number(venta.rows[0].moneda_id)) || monedasCatalogo[0];

      for (const item of items.rows) {
        const productoActual = await client.query(`SELECT * FROM productos WHERE id = $1`, [item.producto_id]);
        const stockAnterior = productoActual.rows[0]?.stock || 0;
        const nuevoStock = stockAnterior + item.cantidad;

        await client.query(`UPDATE productos SET stock = $1 WHERE id = $2`, [nuevoStock, item.producto_id]);

        // La devolución vuelve al costo del producto (en SU moneda) y su equivalente USD
        const monedaProducto = monedaDeProducto(productoActual.rows[0], monedaVenta, monedasCatalogo);
        const costoProducto = Number(productoActual.rows[0]?.costo_base) || 0;
        const costoUsd = aBase(costoProducto, tasaUsd(monedaProducto, monedasCatalogo));
        await client.query(
          `INSERT INTO kardex (producto_id, fecha, tipo, motivo, referencia_tipo, referencia_id, cantidad, costo_unit, costo_unit_base, saldo_anterior, saldo_actual) 
           VALUES ($1, NOW(), 'Entrada', $2, 'venta_anulada', $3, $4, $5, $6, $7, $8)`,
          [item.producto_id, `Anulación venta`, id, item.cantidad, costoProducto, costoUsd, stockAnterior, nuevoStock]
        );
      }

      await client.query(`DELETE FROM venta_items WHERE venta_id = $1`, [id]);
      await client.query(`DELETE FROM ventas WHERE id = $1`, [id]);
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Error al eliminar venta" }, { status: 500 });
  }
}

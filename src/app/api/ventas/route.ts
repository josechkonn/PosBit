export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-server";
import { query, queryOne, execute, transaction } from "@/lib/db";
import { fechaLocalISO } from "@/lib/format";
import { aBase, convertir, redondear, tasaUsd, tasaUsdDocumento, monedaDeProducto, monedaCostoDeProducto, tasaMostrada, tasaPar, desdeBase } from "@/lib/money";
import { triggerBackgroundSync } from "@/lib/sync-engine";

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

export async function GET(request: Request) {
  try {
    await requireSession();
    const { searchParams } = new URL(request.url);

    const clienteId = searchParams.get("cliente_id");
    const search = searchParams.get("search") || searchParams.get("q") || "";
    const cursor = searchParams.get("cursor");
    const hasPage = searchParams.has("page");
    const hasLimit = searchParams.has("limit");
    const page = hasPage ? Math.max(1, parseInt(searchParams.get("page")!, 10) || 1) : (hasLimit ? 1 : null);
    const limit = hasLimit
      ? Math.max(1, parseInt(searchParams.get("limit")!, 10) || 50)
      : (hasPage ? 50 : null);

    const conditions: string[] = [];
    const params: any[] = [];
    let pIdx = 1;

    if (clienteId) {
      conditions.push(`v.cliente_id = $${pIdx++}`);
      params.push(clienteId);
    }

    if (search.trim()) {
      const q = `%${search.trim().toLowerCase()}%`;
      conditions.push(`(
        LOWER(v.numero) LIKE $${pIdx} OR
        LOWER(COALESCE(v.cliente, '')) LIKE $${pIdx} OR
        LOWER(COALESCE(cl.nombre, '')) LIKE $${pIdx} OR
        LOWER(COALESCE(mp.nombre, '')) LIKE $${pIdx} OR
        LOWER(COALESCE(ca.nombre, '')) LIKE $${pIdx}
      )`);
      params.push(q);
      pIdx++;
    }

    if (cursor) {
      // Paginación por cursor: id < cursor (para navegar hacia ventas anteriores)
      conditions.push(`v.id < $${pIdx++}`);
      params.push(cursor);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    let total = 0;
    if (page || limit) {
      const countRes = await queryOne<{ total: number }>(
        `SELECT COUNT(*)::int as total
         FROM ventas v
         LEFT JOIN clientes cl ON v.cliente_id = cl.id
         LEFT JOIN metodos_pago mp ON v.metodo_pago_id = mp.id
         LEFT JOIN cajas ca ON v.caja_id = ca.id
         ${where}`,
        params
      );
      total = countRes?.total ?? 0;
    }

    let paginationClause = "";
    if (limit) {
      paginationClause += ` LIMIT $${pIdx++}`;
      params.push(limit);
      if (page && page > 1) {
        const offset = (page - 1) * limit;
        paginationClause += ` OFFSET $${pIdx++}`;
        params.push(offset);
      }
    }

    const ventas = await query<any>(
      `
      SELECT 
        v.*,
        v.fecha::text as fecha,
        cl.nombre as cliente_nombre,
        COALESCE(mo.codigo, 'COP') as moneda_codigo,
        COALESCE(mo.simbolo, '$') as moneda_simbolo,
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
      LEFT JOIN monedas mo ON v.moneda_id = mo.id
      LEFT JOIN metodos_pago mp ON v.metodo_pago_id = mp.id
      LEFT JOIN cajas ca ON v.caja_id = ca.id
      LEFT JOIN creditos cr ON cr.venta_id = v.id
      ${where}
      ORDER BY v.fecha DESC, v.creado_en DESC, v.id DESC
      ${paginationClause}
      `,
      params
    );

    if (ventas.length === 0) {
      return NextResponse.json({
        ventas: [],
        items: [],
        pagination: {
          page: page ?? 1,
          limit: limit ?? 0,
          total: total,
          totalPages: limit ? Math.ceil(total / limit) : 1,
          nextCursor: null,
          prevCursor: null,
          hasMore: false,
        },
      });
    }

    const ventaIds = ventas.map((v) => v.id);

    const [items, pagos, cobros] = await Promise.all([
      query(
        `SELECT vi.*, COALESCE(pr.nombre, 'Producto') as producto_nombre, COALESCE(pr.codigo, '') as producto_codigo
         FROM venta_items vi
         LEFT JOIN productos pr ON vi.producto_id = pr.id
         WHERE vi.venta_id = ANY($1)
         ORDER BY vi.venta_id, vi.id`,
        [ventaIds]
      ),
      query(
        `SELECT vp.*, mp.nombre as metodo_pago_nombre, COALESCE(mo.codigo, 'COP') as moneda_codigo, COALESCE(mo.simbolo, '$') as moneda_simbolo, COALESCE(mo.decimales, 2) as moneda_decimales
         FROM venta_pagos vp
         LEFT JOIN metodos_pago mp ON vp.metodo_pago_id = mp.id
         LEFT JOIN monedas mo ON vp.moneda_id = mo.id
         WHERE vp.venta_id = ANY($1)
         ORDER BY vp.venta_id, vp.id`,
        [ventaIds]
      ),
      query(
        `SELECT * FROM venta_cobros_extra
         WHERE venta_id = ANY($1)
         ORDER BY venta_id, id`,
        [ventaIds]
      ).catch(() => [] as any[]),
    ]);

    const pagosPorVenta = new Map<any, typeof pagos>();
    for (const p of pagos) {
      const lista = pagosPorVenta.get(p.venta_id) || [];
      lista.push(p);
      pagosPorVenta.set(p.venta_id, lista);
    }
    const ventasConPagos = ventas.map((v) => ({ ...v, pagos: pagosPorVenta.get(v.id) || [] }));

    const cobrosPorVenta = new Map<any, typeof cobros>();
    for (const c of cobros) {
      const lista = cobrosPorVenta.get(c.venta_id) || [];
      lista.push(c);
      cobrosPorVenta.set(c.venta_id, lista);
    }
    const ventasCompletas = ventasConPagos.map((v) => ({
      ...v,
      cobros_extra: cobrosPorVenta.get(v.id) || [],
    }));

    const totalFinal = total || ventas.length;
    const totalPages = limit ? Math.ceil(totalFinal / limit) : 1;
    const nextCursor = ventas.length > 0 ? String(ventas[ventas.length - 1].id) : null;
    const prevCursor = ventas.length > 0 ? String(ventas[0].id) : null;
    const hasMore = limit ? (page ? page * limit < totalFinal : ventas.length === limit) : false;

    return NextResponse.json(
      {
        ventas: ventasCompletas,
        items,
        pagination: {
          page: page ?? 1,
          limit: limit ?? ventas.length,
          total: totalFinal,
          totalPages,
          nextCursor,
          prevCursor,
          hasMore,
        },
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
          Pragma: "no-cache",
        },
      }
    );
  } catch (error) {
    return NextResponse.json({ error: "Error al obtener ventas" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await requireSession();
    const body = await request.json();
    const { cliente, cliente_id, tipo_pago, fecha, moneda_id, metodo_pago_id, caja_id, items, observaciones, descuento = 0, tasa: tasaCustom, monto_pagado, pagos, cobros_extra } = body;

    if (!moneda_id || !items || items.length === 0) {
      return NextResponse.json({ error: "Campos requeridos: moneda_id, items" }, { status: 400 });
    }

    // La fecha la manda el cliente (es el día de SU reloj: el POS la envía para
    // que una venta de las 8pm no quede con la fecha del día siguiente por UTC).
    // Si viene vacía o mal formada se usa la del servidor, que es lo local de
    // esta máquina, en vez de romper el INSERT con un valor inválido.
    const fechaVenta = /^\d{4}-\d{2}-\d{2}$/.test(String(fecha ?? "")) ? fecha : fechaLocalISO();

    // `pagos` (opcional): líneas de pago mixto, cada una con su método/moneda.
    // Sin `pagos` se comporta como antes: `monto_pagado` si viene; si no,
    // crédito = nada pagado y contado = total pagado.
    const lineasPagoReq = Array.isArray(pagos) && pagos.length > 0 ? pagos : null;
    const esCreditoSolicitado = tipo_pago === "Credito" || tipo_pago === "Crédito";
    const esOrigenOffline = Boolean(body.origen_offline);

    // Idempotencia para ventas subidas desde la App Móvil en modo offline:
    // si un reintento de red vuelve a enviar la misma venta móvil, devolver la existente sin duplicarla.
    if (esOrigenOffline && observaciones) {
      const existingOffline = await queryOne(
        `SELECT * FROM ventas WHERE observaciones = $1 LIMIT 1`,
        [String(observaciones)]
      );
      if (existingOffline) {
        return NextResponse.json(existingOffline, { status: 200 });
      }
    }

    const result = await transaction(async (client) => {
      // Catálogo completo (incluso monedas inactivas): la cadena de conversiones
      // debe resolverse aunque una moneda del histórico esté desactivada
      const monedasCatalogo = (await client.query(`SELECT * FROM monedas ORDER BY es_base DESC, codigo ASC`)).rows;
      let monedaVenta = monedasCatalogo.find((m: any) => String(m.id) === String(moneda_id));
      if (!monedaVenta && esOrigenOffline) {
        monedaVenta = monedasCatalogo.find((m: any) => m.es_base) || monedasCatalogo[0];
      }
      if (!monedaVenta) {
        throw new Error("Moneda no encontrada");
      }
      const effectiveMonedaId = monedaVenta.id;
      // Tasa efectiva para el pase a base (USD): la personalizada si vino, si no la de la moneda
      const tasaUsdVenta = tasaUsdDocumento(monedaVenta, tasaCustom, monedasCatalogo);
      // Tasa "de cara al usuario": la personalizada si vino; si no, la directa a
      // USD cuando el modo directo está activo (misma unidad que la personalizada),
      // o la de referencia (p. ej. COP↔BS) en modo cadena.
      const tasaAplicada =
        tasaCustom !== null && tasaCustom !== undefined && Number(tasaCustom) > 0
          ? Number(tasaCustom)
          : tasaMostrada(monedaVenta);

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
      // Suma de los descuentos por línea (en la moneda de la venta). El descuento
      // final de la venta = `descuento` (global del documento) + esto.
      let descuentoItemsTotal = 0;
      const decVenta = Number(monedaVenta.decimales ?? 2);

      for (const item of items) {
        const producto = await client.query(`SELECT * FROM productos WHERE id = $1`, [item.producto_id]);
        if (producto.rows.length === 0) {
          throw new Error(`Producto ${item.producto_id} no encontrado`);
        }
        // `cantidad` SIEMPRE llega en unidades (el POS ya multiplica cajas ×
        // unidades), así que la validación de stock y el kardex no cambian.
        if (!esOrigenOffline && producto.rows[0].stock < item.cantidad) {
          throw new Error(`Existencias insuficientes para ${producto.rows[0].nombre}`);
        }

        // ── Normalización de la línea ──
        // Con presentación, `precio_unit` trae el precio de la CAJA completa, así
        // que el total se calcula con cajas × precio_caja y `precio_unit` se
        // re-expresa por unidad (para que los reportes por unidad sigan valiendo).
        const unidadesPres = Number(item.presentacion_unidades) || 0;
        const cantPres = Number(item.cantidad_presentaciones) || 0;
        let lineTotal: number;

        if (unidadesPres > 0 && cantPres > 0 && item.precio_presentacion != null) {
          // El snapshot viene del cliente, así que se valida contra la BD: la
          // presentación debe existir y tener las mismas unidades que las que
          // envió el cliente. Si algo no cuadra se cae a la línea por unidad
          // en vez de aceptar un total manipulado.
          let presRow: any = null;
          if (item.presentacion_id) {
            const presRes = await client.query(
              `SELECT id, nombre, unidades FROM producto_presentaciones WHERE id = $1`,
              [item.presentacion_id]
            );
            presRow = presRes.rows[0] ?? null;
          }
          if (presRow && Number(presRow.unidades) !== unidadesPres) {
            throw new Error(`La presentación indicada no corresponde a ${producto.rows[0].nombre}`);
          }

          const precioPres = Number(item.precio_presentacion);
          lineTotal = redondear(precioPres * cantPres, decVenta);
          // Snapshot defensivo: el nombre/unidades reales salen de la BD, no del cliente.
          item.presentacion_nombre = presRow ? presRow.nombre : item.presentacion_nombre ?? null;
          item.presentacion_unidades = unidadesPres;
          item.cantidad_presentaciones = cantPres;
          item.precio_presentacion = redondear(precioPres, decVenta);
          item.precio_unit = redondear(precioPres / unidadesPres, decVenta);
        } else {
          // Sin presentación, o sin precio enviado: se toma el precio_base del
          // producto (en SU moneda) y se convierte a la moneda de la venta.
          if (item.precio_unit === null || item.precio_unit === undefined) {
            const monedaProducto = monedaDeProducto(producto.rows[0], monedaVenta, monedasCatalogo);
            item.precio_unit = convertir(
              Number(producto.rows[0].precio_base),
              monedaProducto,
              monedaVenta,
              monedasCatalogo,
              decVenta
            );
          }
          lineTotal = redondear(Number(item.cantidad) * Number(item.precio_unit), decVenta);
        }

        // Se guarda el total EXACTO de la línea: recalcularlo como
        // cantidad × precio_unit después aplicaría un redondeo distinto al de
        // `lineTotal` (precio_caja ÷ unidades) y descuadraría el recibo.
        (item as any).total_linea = lineTotal;

        // Descuento de la línea (monto plano, en la moneda de la venta). Se acota
        // a [0, lineTotal] para que el cliente no pueda dejar importes negativos.
        const descItem = Math.min(lineTotal, Math.max(0, redondear(Number(item.descuento) || 0, decVenta)));
        (item as any).descuento_linea = descItem;
        descuentoItemsTotal = redondear(descuentoItemsTotal + descItem, decVenta);

        subtotalTotal += lineTotal;
        if (!producto.rows[0].iva_incluido) {
          impuestoTotal += Math.round(lineTotal * 0.16 * 100) / 100;
        }
      }

      // Descuento total del documento = global + descuentos de línea.
      const descuentoVenta = redondear(Number(descuento) + descuentoItemsTotal, decVenta);

      // ── Cobros extra (delivery, bolsa, propina, servicio...) ──
      // No son productos: no pasan por stock ni kardex y NO llevan IVA, así que
      // se suman crudo al total. El POS los envía ya convertidos a la moneda de
      // la venta, igual que `descuento`; aquí solo se sanea lo que llega.
      const cobrosExtra = (Array.isArray(cobros_extra) ? cobros_extra : [])
        .map((c: any) => ({
          concepto: String(c?.concepto ?? "").trim().slice(0, 150) || "Cobro extra",
          monto: Math.max(0, redondear(Number(c?.monto) || 0, decVenta)),
        }))
        .filter((c: { monto: number }) => c.monto > 0);
      const cobrosExtraVenta = redondear(
        cobrosExtra.reduce((s: number, c: { monto: number }) => s + c.monto, 0),
        decVenta
      );

      const total = Math.max(0, subtotalTotal - descuentoVenta + impuestoTotal + cobrosExtraVenta);
      // `*_base` siempre en USD, usando la tasa efectiva del documento
      const totalBase = aBase(total, tasaUsdVenta);
      const descuentoBase = aBase(descuentoVenta, tasaUsdVenta);
      const cobrosExtraBase = aBase(cobrosExtraVenta, tasaUsdVenta);

      // ── Pago: cuánto aplica a esta venta y cuánto queda como deuda ──
      // Con `pagos` (pago mixto) cada línea se convierte a la moneda de la
      // venta con la tasa efectiva del documento; lo que sobra de una línea se
      // devuelve como vuelto en SU moneda. Sin `pagos`: `monto_pagado` si viene
      // (pago parcial); si no, crédito = 0 pagado y contado = total pagado.
      interface LineaPagoResuelta {
        metodoId: string;
        cajaId: string;
        monedaId: string;
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
        // El saldo se lleva con los decimales de la moneda de la venta (no 2 fijos).
        let restante = redondear(total, Number(monedaVenta.decimales ?? 2));
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
          const monedaLinea = monedasCatalogo.find((m: any) => String(m.id) === String(met.moneda_id));
          if (!monedaLinea) {
            throw new Error("Moneda del método de pago no encontrada");
          }
          const tasaUsdLinea = tasaUsd(monedaLinea, monedasCatalogo);
          const esMonedaVenta = String(met.moneda_id) === String(moneda_id);

          // La tasa efectiva del documento (tasa personalizada si vino) solo
          // sobreescribe a la moneda de la venta; los pares con su referencia
          // (COP ↔ BS) siguen usando la tasa directa de la moneda.
          const factorPago = tasaPar(monedaLinea, monedaVenta, monedasCatalogo, {
            [String(monedaVenta.id)]: tasaUsdVenta,
          });

          // Entregado → moneda de la venta.
          const montoVenta = esMonedaVenta
            ? montoLinea
            : redondear(montoLinea * factorPago, Number(monedaVenta.decimales ?? 2));
          const aplicado = Math.min(montoVenta, restante);
          // Lo que cubre la línea se mide sobre el SALDO (sin redondear) llevado a
          // la moneda del método, no dividiendo `aplicado` —que ya viene redondeado
          // en la moneda de la venta— porque eso reintroducía el error de centavos
          // en el vuelto (misma regla que aplica el POS).
          const decLineaPago = Number(monedaLinea.decimales ?? 2);
          const restanteLinea = esMonedaVenta ? restante : restante / (factorPago || 1);
          const aplicadoLinea = Math.min(montoLinea, redondear(restanteLinea, decLineaPago));
          const vuelto = redondear(Math.max(0, montoLinea - aplicadoLinea));

          restante = redondear(restante - aplicado);
          pagado = redondear(pagado + aplicado);
          lineasPago.push({
            metodoId: String(met.id),
            cajaId: String(met.caja_id),
            monedaId: String(met.moneda_id),
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
      let metodoVentaId = metodo_pago_id || primeraConEfectivo?.metodoId || null;
      let cajaVentaId =
        pagado > 0.009 ? (caja_id || primeraConEfectivo?.cajaId || null) : null;

      // Si es una venta offline desde móvil sin caja/método explícito, asignar la caja/método por defecto de la moneda
      if (esOrigenOffline && pagado > 0.009 && (!cajaVentaId || !metodoVentaId)) {
        const defaultCaja = await client.query(
          `SELECT ca.id AS caja_id, mp.id AS metodo_id
             FROM cajas ca
             LEFT JOIN metodos_pago mp ON mp.caja_id = ca.id AND mp.activo = true
            WHERE ca.moneda_id = $1
            ORDER BY ca.id ASC, mp.id ASC
            LIMIT 1`,
          [effectiveMonedaId]
        );
        if (defaultCaja.rows.length > 0) {
          if (!cajaVentaId) cajaVentaId = defaultCaja.rows[0].caja_id;
          if (!metodoVentaId) metodoVentaId = defaultCaja.rows[0].metodo_id;
        }
      }

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
        if (String(metodoRow.caja_moneda_id) !== String(moneda_id)) {
          throw new Error("El método de pago debe tener la misma moneda que el crédito");
        }

        // Límite de crédito por moneda: 0 = sin crédito en esa moneda.
        // Se valida contra la deuda que queda (total − pago inicial).
        const codigoMoneda = String(monedaVenta.codigo || "").toUpperCase();
        const limiteRes = await client.query(
          `SELECT limite FROM cliente_limites_credito WHERE cliente_id = $1 AND moneda_id = $2`,
          [cliente_id, effectiveMonedaId]
        );
        const limiteMoneda = parseFloat(limiteRes.rows[0]?.limite || "0");
        if (limiteMoneda <= 0) {
          throw new Error(`${clienteRow.nombre} no tiene crédito habilitado en ${codigoMoneda}`);
        }

        const deudaRes = await client.query(
          `SELECT COALESCE(SUM(saldo), 0) as deuda FROM creditos
           WHERE cliente_id = $1 AND moneda_id = $2 AND estado <> 'Pagado'`,
          [cliente_id, effectiveMonedaId]
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
        `INSERT INTO ventas (numero, cliente, cliente_id, tipo_pago, fecha, moneda_id, metodo_pago_id, caja_id, subtotal, descuento, impuesto, cobros_extra, total, total_base, descuento_base, cobros_extra_base, tasa, estado, observaciones) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) 
         RETURNING *`,
         [generarNumero(), clienteNombre, cliente_id || null, esCredito ? "Credito" : "Contado", fechaVenta, effectiveMonedaId, metodoVentaId, cajaVentaId, subtotalTotal, descuentoVenta, impuestoTotal, cobrosExtraVenta, total, totalBase, descuentoBase, cobrosExtraBase, tasaAplicada, estadoVenta, observaciones || null]
      );

      const venta = ventaRes.rows[0];

      // Detalle de los cobros extra (concepto + monto) para el ticket y el historial
      for (const c of cobrosExtra) {
        await client.query(
          `INSERT INTO venta_cobros_extra (venta_id, concepto, monto, monto_base)
           VALUES ($1, $2, $3, $4)`,
          [venta.id, c.concepto, c.monto, aBase(c.monto, tasaUsdVenta)]
        );
      }

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
        const monedaCosto = monedaCostoDeProducto(producto.rows[0], monedaVenta, monedasCatalogo);
        const precioUnitBase = aBase(item.precio_unit, tasaUsdVenta);
        const subtotalItem = redondear((item as any).total_linea, decVenta);
        const subtotalBase = aBase(subtotalItem, tasaUsdVenta);
        const descItem = redondear((item as any).descuento_linea || 0, decVenta);

        await client.query(
          `INSERT INTO venta_items (venta_id, producto_id, cantidad, precio_unit, precio_unit_base, subtotal, subtotal_base,
                                    descuento, descuento_base,
                                    presentacion_id, presentacion_nombre, presentacion_unidades, cantidad_presentaciones, precio_presentacion)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            venta.id,
            item.producto_id,
            item.cantidad,
            item.precio_unit,
            precioUnitBase,
            subtotalItem,
            subtotalBase,
            descItem,
            aBase(descItem, tasaUsdVenta),
            item.presentacion_id ?? null,
            item.presentacion_nombre ?? null,
            item.presentacion_unidades ?? null,
            item.cantidad_presentaciones ?? null,
            item.precio_presentacion ?? null,
          ]
        );

        // Stock atómico: decrementa solo si hay suficiente (en ventas offline móviles permite GREATEST(0, stock - $1)).
        const stockRes = esOrigenOffline
          ? await client.query(
              `UPDATE productos
               SET stock = GREATEST(0, stock - $1)
               WHERE id = $2
               RETURNING stock + $1 AS anterior, stock AS actual`,
              [item.cantidad, item.producto_id]
            )
          : await client.query(
              `UPDATE productos 
               SET stock = stock - $1 
               WHERE id = $2 AND stock >= $1 
               RETURNING stock + $1 AS anterior, stock AS actual`,
              [item.cantidad, item.producto_id]
            );

        if (stockRes.rows.length === 0) {
          throw new Error(`Stock insuficiente para producto ${item.producto_id}`);
        }

        const stockAnterior = stockRes.rows[0].anterior;
        const nuevoStock = stockRes.rows[0].actual;

        // El kardex guarda el costo en la moneda de COMPRA del producto y su
        // equivalente USD. Costo de salida = CPP vigente (promedio ponderado);
        // fallback legacy al costo_base estático si aún no hay CPP.
        const cppBase = Number(producto.rows[0].costo_promedio_base) || 0;
        const costoEstatico = Number(producto.rows[0].costo_base) || 0;
        const costoUsd = cppBase > 0 ? redondear(cppBase, 6) : aBase(costoEstatico, tasaUsd(monedaCosto, monedasCatalogo));
        const decCostoV = Number(monedaCosto.decimales ?? 2);
        const costoProducto = cppBase > 0
          ? redondear(desdeBase(cppBase, tasaUsd(monedaCosto, monedasCatalogo), 6), decCostoV)
          : costoEstatico;
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
      const entradasCaja: { cajaId: string; monto: number; monedaId: string; montoBase: number; tasa: number }[] = [];
      if (lineasPago.length > 0) {
        for (const l of lineasPago) {
          const efectivo = efectivoLinea(l);
          if (efectivo <= 0.009) continue;
          entradasCaja.push({
            cajaId: l.cajaId,
            monto: efectivo,
            monedaId: l.monedaId,
            montoBase: aBase(efectivo, l.tasaUsdLinea),
            tasa: tasaMostrada(monedasCatalogo.find((m: any) => String(m.id) === String(l.monedaId))),
          });
        }
      } else if (cajaVentaId && metodoVentaId && pagado > 0.009) {
        entradasCaja.push({ cajaId: String(cajaVentaId), monto: pagado, monedaId: String(effectiveMonedaId), montoBase: pagadoBase, tasa: tasaAplicada });
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

    triggerBackgroundSync();
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

    triggerBackgroundSync();
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

      // Si tiene abonos registrados no se puede anular. Se comprueba siempre que
      // exista crédito de la venta (cualquier estado de la venta), no solo
      // cuando la venta está en estado "Credito": una venta pagada puede
      // haber quedado con un crédito abierto.
      const abonosRes = await client.query(
        `SELECT COUNT(*) as count FROM abonos WHERE credito_id IN (SELECT id FROM creditos WHERE venta_id = $1)`,
        [id]
      );
      if (parseInt(abonosRes.rows[0]?.count || "0", 10) > 0) {
        throw new Error("No se puede eliminar: la venta tiene abonos registrados");
      }

      const items = await client.query(`SELECT * FROM venta_items WHERE venta_id = $1`, [id]);
      // Catálogo completo (incluso monedas inactivas): la cadena de conversiones
      // debe resolverse aunque una moneda del histórico esté desactivada
      const monedasCatalogo = (await client.query(`SELECT * FROM monedas`)).rows;
      const monedaVenta =
        monedasCatalogo.find((m: any) => String(m.id) === String(venta.rows[0].moneda_id)) || monedasCatalogo[0];

      for (const item of items.rows) {
        const productoActual = await client.query(`SELECT * FROM productos WHERE id = $1`, [item.producto_id]);
        const stockAnterior = productoActual.rows[0]?.stock || 0;
        const nuevoStock = stockAnterior + item.cantidad;

        await client.query(`UPDATE productos SET stock = $1 WHERE id = $2`, [nuevoStock, item.producto_id]);

        // La devolución vuelve al costo vigente (CPP promedio ponderado) en la moneda
        // de COMPRA del producto y su equivalente USD; fallback legacy.
        const monedaCosto = monedaCostoDeProducto(productoActual.rows[0], monedaVenta, monedasCatalogo);
        const cppBase = Number(productoActual.rows[0]?.costo_promedio_base) || 0;
        const costoEstatico = Number(productoActual.rows[0]?.costo_base) || 0;
        const costoUsd = cppBase > 0 ? redondear(cppBase, 6) : aBase(costoEstatico, tasaUsd(monedaCosto, monedasCatalogo));
        const decCostoV = Number(monedaCosto.decimales ?? 2);
        const costoProducto = cppBase > 0
          ? redondear(desdeBase(cppBase, tasaUsd(monedaCosto, monedasCatalogo), 6), decCostoV)
          : costoEstatico;
        await client.query(
          `INSERT INTO kardex (producto_id, fecha, tipo, motivo, referencia_tipo, referencia_id, cantidad, costo_unit, costo_unit_base, saldo_anterior, saldo_actual) 
           VALUES ($1, NOW(), 'Entrada', $2, 'venta_anulada', $3, $4, $5, $6, $7, $8)`,
          [item.producto_id, `Anulación venta`, id, item.cantidad, costoProducto, costoUsd, stockAnterior, nuevoStock]
        );
      }

      // Revertir y limpiar transacciones de caja asociadas a la venta
      const txsVenta = await client.query(
        `SELECT caja_id, tipo, monto FROM transacciones WHERE referencia_tipo = 'venta' AND referencia_id = $1`,
        [id]
      );
      for (const tx of txsVenta.rows) {
        if (tx.caja_id) {
          if (tx.tipo === 'Entrada') {
            await client.query(`UPDATE cajas SET saldo_actual = saldo_actual - $1, actualizado_en = NOW() WHERE id = $2`, [tx.monto, tx.caja_id]);
          } else if (tx.tipo === 'Salida') {
            await client.query(`UPDATE cajas SET saldo_actual = saldo_actual + $1, actualizado_en = NOW() WHERE id = $2`, [tx.monto, tx.caja_id]);
          }
        }
      }
      await client.query(`DELETE FROM transacciones WHERE referencia_tipo = 'venta' AND referencia_id = $1`, [id]);

      // Crédito y pagos de la venta: se borran explícitamente (aunque la FK ya
      // cascadea) para que anular una venta a crédito no deje al cliente
      // debiendo una deuda de una venta que ya no existe. Los abonos se
      // comprobaron antes que no existan.
      await client.query(`DELETE FROM abonos WHERE credito_id IN (SELECT id FROM creditos WHERE venta_id = $1)`, [id]);
      await client.query(`DELETE FROM creditos WHERE venta_id = $1`, [id]);
      await client.query(`DELETE FROM venta_pagos WHERE venta_id = $1`, [id]);
      await client.query(`DELETE FROM venta_items WHERE venta_id = $1`, [id]);
      await client.query(`DELETE FROM ventas WHERE id = $1`, [id]);
    });

    triggerBackgroundSync();
    return NextResponse.json({ success: true });
  } catch (error) {
    // Se devuelve el mensaje real: antes todo terminaba en un
    // "Error al eliminar venta" genérico que ocultaba el motivo (abonos
    // registrados, venta inexistente, etc.).
    const message = error instanceof Error ? error.message : "Error al eliminar venta";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

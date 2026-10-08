export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-server";
import { query, queryOne, execute, transaction } from "@/lib/db";
import { aBase, convertir, tasaUsd, monedaDeProducto } from "@/lib/money";

export async function GET(request: Request) {
  try {
    await requireSession();
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const searchParam = (searchParams.get("search") || searchParams.get("q") || "").trim();
    const hasSearch = searchParam.length > 0;

    const limitParam = searchParams.get("limit");
    const limit = limitParam ? Math.min(1000, Math.max(1, parseInt(limitParam, 10))) : 20;
    const offset = (page - 1) * limit;

    let whereClause = "WHERE p.activo = true";
    let params: any[] = [limit, offset];

    if (hasSearch) {
      whereClause += ` AND (p.nombre ILIKE $3 OR p.codigo ILIKE $3 OR c.nombre ILIKE $3 OR m.nombre ILIKE $3 OR p.descripcion ILIKE $3)`;
      params.push(`%${searchParam}%`);
    }

    const totalRow = await queryOne<{ count: string }>(
      hasSearch
        ? `SELECT COUNT(*) as count FROM productos p LEFT JOIN categorias c ON p.categoria_id = c.id LEFT JOIN marcas m ON p.marca_id = m.id WHERE p.activo = true AND (p.nombre ILIKE $1 OR p.codigo ILIKE $1 OR c.nombre ILIKE $1 OR m.nombre ILIKE $1 OR p.descripcion ILIKE $1)`
        : `SELECT COUNT(*) as count FROM productos WHERE activo = true`,
      hasSearch ? [`%${searchParam}%`] : []
    );
    const total = Number(totalRow?.count || 0);

    const productos = await query(`
      SELECT 
        p.id, p.codigo, p.nombre, p.descripcion, p.imagen,
        p.stock, p.stock_minimo, p.activo, p.iva_incluido, p.moneda_base_id,
        p.precio_base, p.costo_base,
        p.categoria_id, p.marca_id, p.proveedor_id,
        c.nombre as categoria_nombre,
        m.nombre as marca_nombre,
        pr.nombre as proveedor_nombre,
        json_agg(
          json_build_object(
            'moneda_id', pp.moneda_id,
            'moneda_codigo', mo.codigo,
            'moneda_simbolo', mo.simbolo,
            'precio', pp.precio,
            'costo', pp.costo,
            'es_base', CASE WHEN p.moneda_base_id IS NOT NULL THEN (pp.moneda_id = p.moneda_base_id) ELSE mo.es_base END
          ) ORDER BY mo.es_base DESC, mo.codigo ASC, mo.id ASC
        ) as precios
      FROM productos p
      LEFT JOIN categorias c ON p.categoria_id = c.id
      LEFT JOIN marcas m ON p.marca_id = m.id
      LEFT JOIN proveedores pr ON p.proveedor_id = pr.id
      LEFT JOIN producto_precios pp ON p.id = pp.producto_id
      LEFT JOIN monedas mo ON pp.moneda_id = mo.id
      ${whereClause}
      GROUP BY p.id, c.nombre, m.nombre, pr.nombre
      ORDER BY p.codigo ASC, p.id ASC
      LIMIT $1 OFFSET $2
    `, params);

    const monedas = await query(`SELECT id, codigo, simbolo, tasa, tasa_ref_moneda_id, decimales, es_base FROM monedas WHERE activo = true ORDER BY es_base DESC, codigo ASC, id ASC`);

    return NextResponse.json({
      productos,
      monedas,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error: unknown) {
    console.error("Error al obtener productos:", error);
    const err = error as { message?: string };
    return NextResponse.json({ error: err.message || "Error al obtener productos" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await requireSession();
    const body = await request.json();
    const { codigo, nombre, descripcion, categoria_id, marca_id, proveedor_id, stock, stock_minimo, precio_base, costo_base, activo, iva_incluido, moneda_base_id } = body;

    if (!codigo || !nombre || precio_base === undefined || costo_base === undefined) {
      return NextResponse.json({ error: "Campos requeridos: codigo, nombre, precio_base, costo_base" }, { status: 400 });
    }

    const result = await transaction(async (client) => {
      const res = await client.query(
        `INSERT INTO productos (codigo, nombre, descripcion, categoria_id, marca_id, proveedor_id, stock, stock_minimo, precio_base, costo_base, activo, iva_incluido, moneda_base_id) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) 
         RETURNING *`,
        [codigo, nombre, descripcion || null, categoria_id || null, marca_id || null, proveedor_id || null, stock || 0, stock_minimo || 5, precio_base, costo_base, activo !== false, iva_incluido !== false, moneda_base_id || null]
      );

      const producto = res.rows[0];

      // `precio_base`/`costo_base` están en LA MONEDA DEL PRODUCTO; los precios
      // por moneda se derivan de ahí con la cadena de conversiones (src/lib/money.ts)
      // Catálogo completo (incluso monedas inactivas): los precios históricos
      // deben poder convertirse aunque la moneda esté desactivada
      const monedas = await client.query(`SELECT * FROM monedas`);
      const catalogo = monedas.rows;
      const monedaBase = catalogo.find((m: any) => m.es_base) || catalogo[0];
      const monedaProducto = monedaDeProducto(producto, monedaBase, catalogo);

      for (const moneda of catalogo) {
        let precio: number;
        let costo: number;

        if (body.precios && body.precios[moneda.id]) {
          precio = body.precios[moneda.id].precio;
          costo = body.precios[moneda.id].costo;
        } else {
          const decimales = Number(moneda.decimales ?? 2);
          precio = convertir(Number(precio_base), monedaProducto, moneda, catalogo, decimales);
          costo = convertir(Number(costo_base), monedaProducto, moneda, catalogo, decimales);
        }

        await client.query(
          `INSERT INTO producto_precios (producto_id, moneda_id, precio, costo) 
           VALUES ($1, $2, $3, $4)`,
          [producto.id, moneda.id, precio, costo]
        );
      }

      if (stock > 0) {
        // El kardex guarda el costo en la moneda del producto y su equivalente USD
        const costoUsd = aBase(Number(costo_base), tasaUsd(monedaProducto, catalogo));
        await client.query(
          `INSERT INTO kardex (producto_id, fecha, tipo, motivo, cantidad, costo_unit, costo_unit_base, saldo_anterior, saldo_actual) 
           VALUES ($1, NOW(), 'Entrada', 'Existencias iniciales', $2, $3, $4, 0, $2)`,
          [producto.id, stock, costo_base, costoUsd]
        );
      }

      return producto;
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error: unknown) {
    console.error("Error al crear producto:", error);
    const err = error as { code?: string; constraint?: string; message?: string };
    if (err.code === "23505") {
      if (err.constraint?.includes("codigo")) {
        return NextResponse.json({ error: "Ya existe un producto con ese código" }, { status: 400 });
      }
      return NextResponse.json({ error: "Registro duplicado" }, { status: 400 });
    }
    return NextResponse.json({ error: err.message || "Error al crear producto" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    await requireSession();
    const body = await request.json();
    const { id, codigo, nombre, descripcion, categoria_id, marca_id, proveedor_id, stock, stock_minimo, precio_base, costo_base, activo, iva_incluido, moneda_base_id } = body;

    if (!id) {
      return NextResponse.json({ error: "ID requerido" }, { status: 400 });
    }

    const result = await transaction(async (client) => {
      const productoActual = await client.query(`SELECT * FROM productos WHERE id = $1`, [id]);
      if (productoActual.rows.length === 0) {
        throw new Error("Producto no encontrado");
      }

      const productoAnterior = productoActual.rows[0];

      const res = await client.query(
        `UPDATE productos 
         SET codigo = COALESCE($2, codigo), 
             nombre = COALESCE($3, nombre),
             descripcion = COALESCE($4, descripcion),
             categoria_id = COALESCE($5, categoria_id),
             marca_id = COALESCE($6, marca_id),
             proveedor_id = COALESCE($7, proveedor_id),
             stock = COALESCE($8, stock),
             stock_minimo = COALESCE($9, stock_minimo),
             precio_base = COALESCE($10, precio_base),
             costo_base = COALESCE($11, costo_base),
             activo = COALESCE($12, activo),
             iva_incluido = COALESCE($13, iva_incluido),
             moneda_base_id = COALESCE($14, moneda_base_id)
         WHERE id = $1 
         RETURNING *`,
        [id, codigo, nombre, descripcion, categoria_id, marca_id, proveedor_id || null, stock, stock_minimo, precio_base, costo_base, activo, iva_incluido, moneda_base_id || null]
      );

      const nuevoPrecio = precio_base ?? productoAnterior.precio_base;
      const nuevoCosto = costo_base ?? productoAnterior.costo_base;

      // Igual que en el POST: todo se deriva de `precio_base`/`costo_base`
      // (en la moneda del producto) hacia cada moneda del catálogo
      // Catálogo completo (incluso monedas inactivas): los precios históricos
      // deben poder convertirse aunque la moneda esté desactivada
      const monedas = await client.query(`SELECT * FROM monedas`);
      const catalogo = monedas.rows;
      const monedaBase = catalogo.find((m: any) => m.es_base) || catalogo[0];
      const monedaProducto = monedaDeProducto(res.rows[0], monedaBase, catalogo);

      for (const moneda of catalogo) {
        let precio: number;
        let costo: number;

        if (body.precios && body.precios[moneda.id]) {
          precio = body.precios[moneda.id].precio;
          costo = body.precios[moneda.id].costo;
        } else {
          const decimales = Number(moneda.decimales ?? 2);
          precio = convertir(Number(nuevoPrecio), monedaProducto, moneda, catalogo, decimales);
          costo = convertir(Number(nuevoCosto), monedaProducto, moneda, catalogo, decimales);
        }

        await client.query(
          `INSERT INTO producto_precios (producto_id, moneda_id, precio, costo) 
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (producto_id, moneda_id) 
           DO UPDATE SET precio = $3, costo = $4`,
          [id, moneda.id, precio, costo]
        );
      }

      return res.rows[0];
    });

    if (!result) {
      return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: "Error al actualizar producto" }, { status: 500 });
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

    const compraCount = await queryOne(`SELECT COUNT(*) FROM compra_items WHERE producto_id = $1`, [id]);
    const ventaCount = await queryOne(`SELECT COUNT(*) FROM venta_items WHERE producto_id = $1`, [id]);

    if ((compraCount && parseInt(compraCount.count) > 0) || (ventaCount && parseInt(ventaCount.count) > 0)) {
      return NextResponse.json({ error: "No se puede eliminar: tiene compras o ventas asociadas" }, { status: 400 });
    }

    await execute(`DELETE FROM productos WHERE id = $1`, [id]);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Error al eliminar producto" }, { status: 500 });
  }
}

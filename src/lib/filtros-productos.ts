/**
 * Filtros del catálogo de productos.
 *
 * Vive fuera de la ruta de API a propósito: es lógica de dominio (cómo se
 * traducen unos parámetros de URL a un WHERE de SQL) y así se puede probar
 * sin levantar Next ni la base.
 */

/** Dimensión de filtro. Se usa para calcular facetas (omitiendo la propia). */
export type DimFiltro = "categoria" | "marca" | "proveedor";

export interface FiltrosProductos {
  busqueda: string;
  categorias: string[];
  marcas: string[];
  proveedores: string[];
  estadoProd: "todos" | "activo" | "inactivo";
  existencia: "todos" | "con_stock" | "bajo_minimo" | "sin_stock";
  iva: "todos" | "incluido" | "excluido";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Lee los filtros de la query string. Todo es opcional: si no viene nada se
 * comporta como antes (catálogo activo completo).
 *
 * Los ids llegan separados por coma porque la barra usa selección múltiple.
 * Se descartan los que no parezcan UUID para que un valor corrupto en la URL no
 * reviente la consulta con un error de sintaxis de PostgreSQL.
 */
export function leerFiltros(sp: URLSearchParams): FiltrosProductos {
  const lista = (raw: string | null): string[] =>
    (raw || "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => UUID.test(s));

  const unoDe = <T extends string>(raw: string | null, validos: readonly T[], def: T): T =>
    validos.includes((raw || "") as T) ? ((raw || "") as T) : def;

  return {
    busqueda: (sp.get("search") || sp.get("q") || "").trim(),
    categorias: lista(sp.get("categoria")),
    marcas: lista(sp.get("marca")),
    proveedores: lista(sp.get("proveedor")),
    estadoProd: unoDe(sp.get("estado_prod"), ["activo", "inactivo"] as const, "todos"),
    existencia: unoDe(
      sp.get("existencia"),
      ["con_stock", "bajo_minimo", "sin_stock"] as const,
      "todos"
    ),
    iva: unoDe(sp.get("iva"), ["incluido", "excluido"] as const, "todos"),
  };
}

/** ¿El usuario pidió algo? Determina si hay que calcular facetas. */
export function SIN_FILTROS(f: FiltrosProductos): boolean {
  return (
    f.busqueda === "" &&
    f.categorias.length === 0 &&
    f.marcas.length === 0 &&
    f.proveedores.length === 0 &&
    f.estadoProd === "todos" &&
    f.existencia === "todos" &&
    f.iva === "todos"
  );
}

/**
 * Construye el WHERE y sus parámetros desde un único acumulador.
 *
 * Que el conteo y la consulta principal compartan ESTE constructor es lo que
 * evita que se desincronicen: antes cada uno escribía su propio WHERE a mano,
 * con numeración de parámetros distinta, y el de conteo se olvidaba de
 * `activo`, de la búsqueda y de los filtros.
 *
 * `omitir` quita una dimensión. Se usa para las facetas: el conteo de
 * Categorías debe evaluar los productos que coinciden con el RESTO de filtros,
 * no solo los de las categorías ya elegidas — si no, al filtrar "Sin
 * existencias" las demás categorías desaparecerían de la lista.
 *
 * Requiere que la consulta tenga los LEFT JOIN de `categorias` y `marcas`
 * (la búsqueda los usa).
 */
export function construirWhere(f: FiltrosProductos, omitir?: DimFiltro) {
  const conds: string[] = [];
  const params: unknown[] = [];
  const ph = (valor: unknown): string => {
    params.push(valor);
    return `$${params.length}`;
  };

  if (f.busqueda) {
    // Un solo parámetro reutilizado cinco veces (ILIKE no acepta listas).
    const p = ph(`%${f.busqueda}%`);
    conds.push(
      `(p.nombre ILIKE ${p} OR p.codigo ILIKE ${p} OR c.nombre ILIKE ${p} OR m.nombre ILIKE ${p} OR p.descripcion ILIKE ${p})`
    );
  }

  if (f.estadoProd !== "todos") {
    conds.push(`p.activo = ${f.estadoProd === "activo"}`);
  }

  if (f.existencia === "sin_stock") {
    conds.push("p.stock = 0");
  } else if (f.existencia === "bajo_minimo") {
    conds.push("p.stock > 0 AND p.stock <= p.stock_minimo");
  } else if (f.existencia === "con_stock") {
    conds.push("p.stock > 0");
  }

  if (f.iva !== "todos") {
    conds.push(`p.iva_incluido = ${f.iva === "incluido"}`);
  }

  if (f.categorias.length > 0 && omitir !== "categoria") {
    conds.push(`p.categoria_id = ANY(${ph(f.categorias)}::uuid[])`);
  }
  if (f.marcas.length > 0 && omitir !== "marca") {
    conds.push(`p.marca_id = ANY(${ph(f.marcas)}::uuid[])`);
  }
  if (f.proveedores.length > 0 && omitir !== "proveedor") {
    // El proveedor se busca en la relación N:M, que es la que gestiona el
    // modal: así "productos de este proveedor" incluye también aquellos donde
    // figura como proveedor secundario.
    conds.push(
      `EXISTS (SELECT 1 FROM producto_proveedores x WHERE x.producto_id = p.id AND x.proveedor_id = ANY(${ph(f.proveedores)}::uuid[]))`
    );
  }

  return { where: conds.length ? `WHERE ${conds.join(" AND ")}` : "", params };
}

export interface Faceta {
  id: string;
  nombre: string;
  n: number;
}

/** Placeholders de LIMIT/OFFSET que van justo detrás de los del WHERE. */
export function placeholdersPaginacion(nParams: number) {
  return { limitPh: `$${nParams + 1}`, offsetPh: `$${nParams + 2}` };
}

/**
 * Conteos por dimensión para poblar los desplegables ("Alimentos (30)").
 *
 * Cada dimensión se cuenta omitiéndose a sí misma, que es el comportamiento
 * estándar de faceta: el número dice cuántos productos obtendrías si
 * agregaras esa opción al filtro actual.
 *
 * La tabla de la dimensión usa un alias propio (`cat`, `mar`, `pv`) para no
 * chocar con los alias `c`/`m`/`p` que usa el WHERE compartido.
 */
export async function calcularFacetas(
  f: FiltrosProductos,
  q: (sql: string, params?: unknown[]) => Promise<any[]>
) {
  const consulta = async (omitir: DimFiltro, sql: (where: string) => string) => {
    const b = construirWhere(f, omitir);
    return q(sql(b.where), b.params);
  };

  const categorias = await consulta("categoria", (where) => `
    SELECT cat.id, cat.nombre, COUNT(p.id) AS n
    FROM categorias cat
    LEFT JOIN productos p ON p.categoria_id = cat.id
    LEFT JOIN categorias c ON p.categoria_id = c.id
    LEFT JOIN marcas m ON p.marca_id = m.id
    ${where} ${where ? "AND" : "WHERE"} cat.activo = true
    GROUP BY cat.id, cat.nombre
    ORDER BY COUNT(p.id) DESC, cat.nombre ASC`);

  const marcas = await consulta("marca", (where) => `
    SELECT mar.id, mar.nombre, COUNT(p.id) AS n
    FROM marcas mar
    LEFT JOIN productos p ON p.marca_id = mar.id
    LEFT JOIN categorias c ON p.categoria_id = c.id
    LEFT JOIN marcas m ON p.marca_id = m.id
    ${where} ${where ? "AND" : "WHERE"} mar.activo = true
    GROUP BY mar.id, mar.nombre
    ORDER BY COUNT(p.id) DESC, mar.nombre ASC`);

  const proveedores = await consulta("proveedor", (where) => `
    SELECT pv.id, pv.nombre, COUNT(p.id) AS n
    FROM proveedores pv
    LEFT JOIN producto_proveedores x ON x.proveedor_id = pv.id
    LEFT JOIN productos p ON p.id = x.producto_id
    LEFT JOIN categorias c ON p.categoria_id = c.id
    LEFT JOIN marcas m ON p.marca_id = m.id
    ${where} ${where ? "AND" : "WHERE"} pv.activo = true
    GROUP BY pv.id, pv.nombre
    ORDER BY COUNT(p.id) DESC, pv.nombre ASC`);

  const aFacetas = (filas: any[]): Faceta[] =>
    filas.map((r) => ({ id: String(r.id), nombre: r.nombre, n: Number(r.n) }));

  return {
    categorias: aFacetas(categorias),
    marcas: aFacetas(marcas),
    proveedores: aFacetas(proveedores),
  };
}
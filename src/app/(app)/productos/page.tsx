"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Download, Filter, Plus, X, Barcode } from "lucide-react";
import { ActionButtons } from "@/components/ui/action-buttons";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { SearchBar } from "@/components/ui/search-bar";
import { Table, Td, Tr, HeaderConfig } from "@/components/ui/table";
import { ProductoModal } from "@/components/producto/producto-modal";
import { fmt } from "@/lib/format";
import { margenSobreCosto } from "@/lib/money";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import * as XLSX from "xlsx";

interface Producto {
  id: number;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  imagen: string | null;
  categoria_id: string | null;
  marca_id: string | null;
  moneda_base_id?: string | null;
  moneda_costo_id?: string | null;
  stock: number;
  stock_minimo: number;
  activo: boolean;
  iva_incluido: boolean;
  precio_base: number;
  costo_base: number;
  categoria_nombre: string | null;
  marca_nombre: string | null;
  /** Proveedor principal (`productos.proveedor_id`). */
  proveedor_nombre?: string | null;
  /** Todos los proveedores del producto (relación N:M). */
  proveedores?: Array<{ id: string; nombre: string }>;
  precios: Array<{
    moneda_id: string;
    moneda_codigo: string;
    moneda_simbolo: string;
    precio: number;
    costo: number;
    es_base: boolean;
  }>;
  presentaciones?: Array<{
    id: string;
    nombre: string;
    unidades: number;
    activo: boolean;
    precio: number;
    costo: number;
    modo_venta?: "derivado" | "fijo" | "margen";
    precio_override?: number | null;
    margen_override?: number | null;
  }>;
}

interface Moneda {
  id: string;
  codigo: string;
  simbolo: string;
  tasa: number;
  decimales: number;
  es_base: boolean;
}

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

type ModalMode = "create" | "edit" | "view" | "delete";

const PAGE_SIZE = 20;

/** Modo de precio de una presentación (3 modos). */
type ModoPres = "derivado" | "fijo" | "margen";

/**
 * Celda de presentaciones: cada una con su PRECIO real de venta.
 *
 * El precio llega ya resuelto por la API según el modo de cada presentación
 * (`derivado` = unidad × unidades, `fijo` = override, `margen` = CPP ×
 * unidades × (1+m)). Se muestra la etiqueta del modo solo cuando NO es
 * derivado, para que el caso normal (que es el frecuente) quede limpio.
 *
 * El texto va en `text-xs` (no `text-[10px]`) a propósito: se lee de un vistazo
 * sin obligar a acercar la pantalla.
 */
function PresentacionesCelda({
  presentaciones,
  codMoneda,
}: {
  presentaciones: Array<{
    id: string;
    nombre: string;
    unidades: number;
    precio: number;
    codigo?: string | null;
    modo_venta?: ModoPres;
    precio_override?: number | null;
    margen_override?: number | null;
  }>;
  codMoneda: string;
}) {
  if (presentaciones.length === 0) {
    return <span className="text-muted-foreground">Por unidad</span>;
  }

  return (
    <div className="flex flex-col gap-1">
      {presentaciones.map((pr) => (
        <div key={pr.id} className="flex items-baseline gap-2 flex-wrap">
          <span className="flex items-baseline gap-1.5">
            <span className="font-medium text-foreground">{pr.nombre}</span>
            <span className="text-xs text-muted-foreground">×{pr.unidades}</span>
          </span>
          <span className="font-mono text-xs font-semibold text-primary">
            {fmt(pr.precio, codMoneda)}
          </span>
          {pr.modo_venta === "margen" && (
            <span className="text-xs text-muted-foreground/80">+{pr.margen_override}%</span>
          )}
          {pr.modo_venta === "fijo" && (
            <span className="rounded bg-muted px-1 py-px text-[10px] font-medium uppercase text-muted-foreground">
              fijo
            </span>
          )}
          {/* Código de barras propio de la caja: es lo que se escanea para
              cobrarla como caja. Sin código solo se agrega desde el desplegable. */}
          {pr.codigo ? (
            <span className="rounded bg-primary/10 px-1 py-px font-mono text-[10px] font-semibold text-primary">
              {pr.codigo}
            </span>
          ) : (
            <span className="text-[10px] italic text-muted-foreground/60">sin código</span>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Margen real (%) del producto: precio de venta vs. costo de compra, ambos en
 * la moneda de VENTA (la fila `es_base` de `precios`, ya derivada por la API con
 * el método de conversión configurado). `null` si no hay costo/precio válido.
 * Es markup sobre costo: misma semántica que `margen_ganancia`
 * (precio = costo × (1 + margen/100)).
 */
function margenRealDeProducto(p: Producto): number | null {
  const fila = p.precios?.find((pr) => pr.es_base);
  return fila ? margenSobreCosto(fila.precio, fila.costo) : null;
}

export default function ProductosPage() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [monedas, setMonedas] = useState<Moneda[]>([]);
  const [pagination, setPagination] = useState<PaginationInfo>({ page: 1, limit: PAGE_SIZE, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode>("create");
  const [selectedProducto, setSelectedProducto] = useState<Producto | null>(null);

  // Sorting state
  const [sortKey, setSortKey] = useState<string>("codigo");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  // Filters state
  const [showFilters, setShowFilters] = useState(false);
  const [selectedCategoria, setSelectedCategoria] = useState("");
  const [selectedMarca, setSelectedMarca] = useState("");
  const [selectedEstado, setSelectedEstado] = useState("todos");
  const [categorias, setCategorias] = useState<Array<{ id: string; nombre: string }>>([]);
  const [marcas, setMarcas] = useState<Array<{ id: string; nombre: string }>>([]);

  const barcodeBuffer = useRef("");
  const lastKeyTime = useRef(0);
  const { toast } = useToast();

  const fetchData = useCallback(async (page: number, queryStr?: string) => {
    setLoading(true);
    try {
      const q = (queryStr !== undefined ? queryStr : search).trim();
      const url = q
        ? `/api/productos?page=1&limit=1000&search=${encodeURIComponent(q)}`
        : `/api/productos?page=${page}&limit=${PAGE_SIZE}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setProductos(data.productos || []);
        setMonedas(data.monedas || []);
        setPagination(data.pagination || { page: 1, limit: PAGE_SIZE, total: 0, totalPages: 0 });
      }
    } catch (error) {
      console.error("Error al obtener productos:", error);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    fetchData(currentPage);
  }, [currentPage, search, fetchData]);

  useEffect(() => {
    fetch("/api/categorias").then((r) => (r.ok ? r.json() : [])).then(setCategorias).catch(() => {});
    fetch("/api/marcas").then((r) => (r.ok ? r.json() : [])).then(setMarcas).catch(() => {});
  }, []);

  // Escáner de código de barras físico (hardware barcode listener)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Si el modal de edición/creación de producto está abierto, no interferir
      if (modalOpen) return;

      const isInput = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;

      // Si el usuario ya está escribiendo o enfocado en un input (ej. la barra de búsqueda),
      // dejamos que el input reciba el texto normalmente y capturamos el "Enter" enviado por el escáner
      if (isInput) {
        if (e.key === "Enter") {
          const val = (e.target as HTMLInputElement).value?.trim();
          if (val) {
            fetchData(1, val);
          }
        }
        return;
      }

      // Si NO hay ningún input enfocado (usuario en la pantalla general), capturar ráfaga de teclas del lector
      const now = Date.now();
      if (now - lastKeyTime.current > 100) {
        barcodeBuffer.current = ""; // Reset si pasaron más de 100ms
      }
      lastKeyTime.current = now;

      if (e.key === "Enter") {
        const code = barcodeBuffer.current.trim();
        if (code) {
          e.preventDefault();
          setSearch(code);
          fetchData(1, code).then(() => {
            toast(`Código escaneado: "${code}"`, "info");
          });
        }
        barcodeBuffer.current = "";
      } else if (e.key.length === 1) {
        barcodeBuffer.current += e.key;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [modalOpen, fetchData, toast]);

  const activeFiltersCount =
    (selectedCategoria ? 1 : 0) +
    (selectedMarca ? 1 : 0) +
    (selectedEstado !== "todos" ? 1 : 0);

  const clearFilters = () => {
    setSelectedCategoria("");
    setSelectedMarca("");
    setSelectedEstado("todos");
  };

  const getEstado = (p: Producto) => {
    if (p.stock === 0) return "Sin Existencias";
    if (p.stock <= p.stock_minimo) return "Bajo Existencias";
    return "Activo";
  };

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortOrder("asc");
    }
  };

  const filteredProductos = useMemo(() => {
    let list = productos;

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) =>
          p.nombre.toLowerCase().includes(q) ||
          p.codigo.toLowerCase().includes(q) ||
          (p.categoria_nombre && p.categoria_nombre.toLowerCase().includes(q)) ||
          (p.marca_nombre && p.marca_nombre.toLowerCase().includes(q)) ||
          (p.descripcion && p.descripcion.toLowerCase().includes(q))
      );
    }

    if (selectedCategoria) {
      list = list.filter((p) => p.categoria_id?.toString() === selectedCategoria);
    }

    if (selectedMarca) {
      list = list.filter((p) => p.marca_id?.toString() === selectedMarca);
    }

    if (selectedEstado && selectedEstado !== "todos") {
      list = list.filter((p) => {
        if (selectedEstado === "sin_stock") return p.stock === 0;
        if (selectedEstado === "bajo_stock") return p.stock > 0 && p.stock <= p.stock_minimo;
        if (selectedEstado === "activo") return p.activo && p.stock > p.stock_minimo;
        if (selectedEstado === "inactivo") return !p.activo;
        return true;
      });
    }

    if (sortKey) {
      list = [...list].sort((a, b) => {
        let aVal: any = a[sortKey as keyof Producto];
        let bVal: any = b[sortKey as keyof Producto];

        if (sortKey.startsWith("costo_")) {
          const code = sortKey.replace("costo_", "");
          aVal = a.precios?.find((p) => p.moneda_codigo === code)?.costo ?? 0;
          bVal = b.precios?.find((p) => p.moneda_codigo === code)?.costo ?? 0;
        } else if (sortKey.startsWith("precio_")) {
          const code = sortKey.replace("precio_", "");
          aVal = a.precios?.find((p) => p.moneda_codigo === code)?.precio ?? 0;
          bVal = b.precios?.find((p) => p.moneda_codigo === code)?.precio ?? 0;
        } else if (sortKey === "margen") {
          aVal = margenRealDeProducto(a) ?? -Infinity;
          bVal = margenRealDeProducto(b) ?? -Infinity;
        }

        if (aVal === null || aVal === undefined) aVal = "";
        if (bVal === null || bVal === undefined) bVal = "";

        if (typeof aVal === "number" && typeof bVal === "number") {
          return sortOrder === "asc" ? aVal - bVal : bVal - aVal;
        }

        const comp = String(aVal).localeCompare(String(bVal), undefined, { numeric: true, sensitivity: "base" });
        return sortOrder === "asc" ? comp : -comp;
      });
    }

    return list;
  }, [productos, search, selectedCategoria, selectedMarca, selectedEstado, sortKey, sortOrder]);

  // Cada columna declara su banda con `group`: columnas contiguas del mismo grupo
  // se fusionan bajo una cabecera de nivel superior. Así "USD / VES / COP" se lee
  // como un bloque de Costos y otro de Precios, en vez de seis columnas sueltas.
  // El orden del cuerpo DEBE seguir esta lista (la comprobación de `Table`
  // avisa en desarrollo si el número de celdas no coincide).
  const headers: HeaderConfig[] = useMemo(() => [
    { label: "" },
    { key: "codigo", label: "Código", sortable: true, group: "Datos del producto" },
    { key: "nombre", label: "Nombre", sortable: true, group: "Datos del producto" },
    { key: "stock", label: "Existencias", sortable: true, group: "Datos del producto" },
    { label: "IVA", group: "Datos del producto" },
    { label: "Precio caja", group: "Presentaciones" },
    ...monedas.map((m) => ({ key: `costo_${m.codigo}`, label: m.codigo, sortable: true, group: "Costos" })),
    ...monedas.map((m) => ({ key: `precio_${m.codigo}`, label: m.codigo, sortable: true, group: "Precios" })),
    { key: "margen", label: "%", sortable: true, group: "Margen", className: "bg-warning/20 text-warning-strong" },
    { key: "categoria_nombre", label: "Categoría", sortable: true, group: "Clasificación" },
    { key: "marca_nombre", label: "Marca", sortable: true, group: "Clasificación" },
    { key: "proveedor_nombre", label: "Proveedor", sortable: true, group: "Clasificación" },
    { label: "Estado" },
    { label: "Acciones" },
  ], [monedas]);

  const handleExport = () => {
    if (filteredProductos.length === 0) return;

    const dataToExport = filteredProductos.map((p) => {
      const precios = p.precios || [];

      const row: Record<string, string | number> = {
        "Código": p.codigo || "",
        "Nombre": p.nombre || "",
        "Descripción": p.descripcion || "",
        "Categoría": p.categoria_nombre || "—",
        "Marca": p.marca_nombre || "—",
        "Existencias": p.stock,
        "Existencias Mínimas": p.stock_minimo,
        "IVA Incluido": p.iva_incluido ? "Sí" : "No",
      };

      for (const m of monedas) {
        const pr = precios.find((x) => x.moneda_codigo === m.codigo);
        row[`Costo (${m.codigo})`] = pr ? pr.costo : 0;
      }

      for (const m of monedas) {
        const pr = precios.find((x) => x.moneda_codigo === m.codigo);
        row[`Precio (${m.codigo})`] = pr ? pr.precio : 0;
      }

      const margen = margenRealDeProducto(p);
      row["Margen (%)"] = margen == null ? "" : Number(margen.toFixed(2));

      row["Estado"] = getEstado(p);

      return row;
    });

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Catálogo");

    if (dataToExport.length > 0) {
      const keys = Object.keys(dataToExport[0]);
      worksheet["!cols"] = keys.map((key) => ({
        wch: Math.max(
          key.length,
          ...dataToExport.map((r) => String(r[key] ?? "").length)
        ) + 3,
      }));
    }

    XLSX.writeFile(
      workbook,
      `productos_inventario_${new Date().toISOString().slice(0, 10)}.xlsx`
    );
  };

  const openModal = (mode: ModalMode, producto: Producto | null = null) => {
    setModalMode(mode);
    setSelectedProducto(producto);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setSelectedProducto(null);
  };

  const handleSuccess = (message: string) => {
    fetchData(currentPage);
    toast(message, "success");
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      fetchData(1, search.trim());
    }
  };

  return (
    <div>
      <PageHeader
        title="Productos"
        subtitle="Gestión del catálogo de productos"
        action={
          <Button onClick={() => openModal("create")}>
            <Plus size={14} /> Nuevo Producto
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchBar
          placeholder="Escanear código de barras o buscar por nombre/código..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={handleSearchKeyDown}
        />
        <Button
          variant={showFilters || activeFiltersCount > 0 ? "primary" : "outline"}
          onClick={() => setShowFilters(!showFilters)}
        >
          <Filter size={13} /> Filtros {activeFiltersCount > 0 && `(${activeFiltersCount})`}
        </Button>
        <Button variant="outline" onClick={handleExport} disabled={filteredProductos.length === 0}>
          <Download size={13} /> Exportar
        </Button>
      </div>

      {showFilters && (
        <div className="mb-4 rounded-lg border border-border bg-card p-4 shadow-sm animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Filtrar catálogo
            </span>
            {activeFiltersCount > 0 && (
              <button
                onClick={clearFilters}
                className="text-xs text-primary hover:underline font-medium flex items-center gap-1"
              >
                <X size={12} /> Limpiar filtros
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Categoría</label>
              <select
                value={selectedCategoria}
                onChange={(e) => setSelectedCategoria(e.target.value)}
                className="w-full rounded border border-border bg-background px-3 py-1.5 text-xs focus:border-primary focus:outline-none"
              >
                <option value="">Todas las categorías</option>
                {categorias.map((c) => (
                  <option key={c.id} value={c.id.toString()}>
                    {c.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Marca</label>
              <select
                value={selectedMarca}
                onChange={(e) => setSelectedMarca(e.target.value)}
                className="w-full rounded border border-border bg-background px-3 py-1.5 text-xs focus:border-primary focus:outline-none"
              >
                <option value="">Todas las marcas</option>
                {marcas.map((m) => (
                  <option key={m.id} value={m.id.toString()}>
                    {m.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Estado de Existencias</label>
              <select
                value={selectedEstado}
                onChange={(e) => setSelectedEstado(e.target.value)}
                className="w-full rounded border border-border bg-background px-3 py-1.5 text-xs focus:border-primary focus:outline-none"
              >
                <option value="todos">Todos los estados</option>
                <option value="activo">Existencias Normales (Activo)</option>
                <option value="bajo_stock">Bajo Existencias</option>
                <option value="sin_stock">Sin Existencias</option>
                <option value="inactivo">Inactivo</option>
              </select>
            </div>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <Table
          headers={headers}
          sortKey={sortKey}
          sortOrder={sortOrder}
          onSort={handleSort}
        >
          {loading ? (
            <Tr>
              <Td colSpan={headers.length} className="text-center py-8 text-muted-foreground">
                Cargando...
              </Td>
            </Tr>
          ) : filteredProductos.length === 0 ? (
            <Tr>
              <Td colSpan={headers.length} className="text-center py-8 text-muted-foreground">
                {search || activeFiltersCount > 0 ? "No se encontraron resultados para el filtro" : "No hay productos registrados"}
              </Td>
            </Tr>
          ) : (
            filteredProductos.map((p) => {
              const precios = p.precios?.filter((pr) => pr.moneda_id !== null) || [];
              const margen = margenRealDeProducto(p);
              return (
                <Tr key={p.id}>
                  <Td>
                    {p.imagen ? (
                      <img
                        src={p.imagen}
                        alt={p.nombre}
                        className="h-10 w-10 rounded-md border border-border object-cover"
                      />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-muted text-xs text-muted-foreground">
                        —
                      </div>
                    )}
                  </Td>
                  <Td mono>{p.codigo}</Td>
                  <Td>
                    <span className="font-medium text-foreground">{p.nombre}</span>
                  </Td>
                  <Td>
                    <span
                      className={cn(
                        "font-mono font-semibold",
                        p.stock === 0 ? "text-danger" : p.stock <= p.stock_minimo ? "text-warning" : "text-success"
                      )}
                    >
                      {p.stock}
                    </span>
                  </Td>
                  <Td>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                      p.iva_incluido
                        ? "bg-primary/10 text-primary"
                        : "bg-warning/10 text-warning"
                    }`}>
                      {p.iva_incluido ? "Incl." : "Excl."}
                    </span>
                  </Td>
                  <Td>
                    <PresentacionesCelda
                      presentaciones={(p.presentaciones || []).filter((pr) => pr.activo)}
                      codMoneda={monedas.find((m) => m.id === p.moneda_base_id)?.codigo ?? "USD"}
                    />
                  </Td>
                  {monedas.map((mon) => {
                    const precio = precios.find((pr) => pr.moneda_codigo === mon.codigo);
                    return (
                      <Td key={`costo-${mon.codigo}`} mono>
                        {precio ? fmt(precio.costo, mon.codigo) : "—"}
                      </Td>
                    );
                  })}
                  {monedas.map((mon) => {
                    const precio = precios.find((pr) => pr.moneda_codigo === mon.codigo);
                    return (
                      <Td key={`precio-${mon.codigo}`} mono>
                        {precio ? fmt(precio.precio, mon.codigo) : "—"}
                      </Td>
                    );
                  })}
                  <Td className="bg-warning/10">
                    {margen == null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span className="font-mono font-semibold text-warning-strong">
                        {margen.toFixed(2)} %
                      </span>
                    )}
                  </Td>
                  <Td>{p.categoria_nombre || "—"}</Td>
                  <Td>{p.marca_nombre || "—"}</Td>
                  <Td>
                    {p.proveedor_nombre ? (
                      <span className="flex items-center gap-1.5">
                        <span className="truncate">{p.proveedor_nombre}</span>
                        {(p.proveedores?.length ?? 0) > 1 && (
                          <span
                            className="shrink-0 rounded bg-muted px-1 py-px text-[10px] font-medium text-muted-foreground"
                            title={(p.proveedores || []).map((x) => x.nombre).join(", ")}
                          >
                            +{p.proveedores!.length - 1}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </Td>
                  <Td>
                    <StatusBadge status={getEstado(p)} />
                  </Td>
                  <Td>
                    <ActionButtons
                      onView={() => openModal("view", p)}
                      onEdit={() => openModal("edit", p)}
                      onDelete={() => openModal("delete", p)}
                    />
                  </Td>
                </Tr>
              );
            })
          )}
        </Table>
      </div>

      <Pagination
        currentPage={pagination.page}
        totalPages={pagination.totalPages}
        totalItems={pagination.total}
        pageSize={pagination.limit}
        noun="productos"
        onPageChange={setCurrentPage}
      />

      <ProductoModal
        open={modalOpen}
        mode={modalMode}
        producto={selectedProducto}
        monedas={monedas}
        onClose={closeModal}
        onSuccess={handleSuccess}
      />
    </div>
  );
}

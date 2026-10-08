"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Download, Filter, Plus, X } from "lucide-react";
import { ActionButtons } from "@/components/ui/action-buttons";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { SearchBar } from "@/components/ui/search-bar";
import { Table, Td, Tr, HeaderConfig } from "@/components/ui/table";
import { ProductoModal } from "@/components/producto/producto-modal";
import { fmt } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import * as XLSX from "xlsx";

interface Producto {
  id: number;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  imagen: string | null;
  categoria_id: number | null;
  marca_id: number | null;
  moneda_base_id?: number | null;
  stock: number;
  stock_minimo: number;
  activo: boolean;
  iva_incluido: boolean;
  precio_base: number;
  costo_base: number;
  categoria_nombre: string | null;
  marca_nombre: string | null;
  precios: Array<{
    moneda_id: number;
    moneda_codigo: string;
    moneda_simbolo: string;
    precio: number;
    costo: number;
    es_base: boolean;
  }>;
}

interface Moneda {
  id: number;
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
  const [categorias, setCategorias] = useState<Array<{ id: number; nombre: string }>>([]);
  const [marcas, setMarcas] = useState<Array<{ id: number; nombre: string }>>([]);

  const fetchData = useCallback(async (page: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/productos?page=${page}&limit=${PAGE_SIZE}`);
      if (res.ok) {
        const data = await res.json();
        setProductos(data.productos);
        setMonedas(data.monedas);
        setPagination(data.pagination);
      }
    } catch (error) {
      console.error("Error al obtener productos:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(currentPage);
    fetch("/api/categorias").then((r) => r.json()).then(setCategorias).catch(() => {});
    fetch("/api/marcas").then((r) => r.json()).then(setMarcas).catch(() => {});
  }, [currentPage, fetchData]);

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

  const headers: HeaderConfig[] = useMemo(() => [
    "",
    { key: "codigo", label: "Código", sortable: true },
    { key: "nombre", label: "Producto", sortable: true },
    { key: "categoria_nombre", label: "Categoría", sortable: true },
    { key: "marca_nombre", label: "Marca", sortable: true },
    { key: "stock", label: "Existencias", sortable: true },
    "IVA",
    ...monedas.map((m) => ({ key: `costo_${m.codigo}`, label: `Costo ${m.codigo}`, sortable: true })),
    ...monedas.map((m) => ({ key: `precio_${m.codigo}`, label: `Precio ${m.codigo}`, sortable: true })),
    "Estado",
    "Acciones",
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

  const { toast } = useToast();

  const handleSuccess = (message: string) => {
    fetchData(currentPage);
    toast(message, "success");
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
          placeholder="Buscar: harina, arroz, 789..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
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
              <Td colSpan={12 + monedas.length * 2} className="text-center py-8 text-muted-foreground">
                Cargando...
              </Td>
            </Tr>
          ) : filteredProductos.length === 0 ? (
            <Tr>
              <Td colSpan={12 + monedas.length * 2} className="text-center py-8 text-muted-foreground">
                {search || activeFiltersCount > 0 ? "No se encontraron resultados para el filtro" : "No hay productos registrados"}
              </Td>
            </Tr>
          ) : (
            filteredProductos.map((p) => {
              const precios = p.precios?.filter((pr) => pr.moneda_id !== null) || [];
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
                  <Td>{p.categoria_nombre || "—"}</Td>
                  <Td>{p.marca_nombre || "—"}</Td>
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

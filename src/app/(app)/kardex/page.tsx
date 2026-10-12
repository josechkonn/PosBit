"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, RefreshCw, Download, Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { SearchBar } from "@/components/ui/search-bar";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { StatCard } from "@/components/ui/stat-card";
import { Table, Td, Tr, HeaderConfig } from "@/components/ui/table";
import { Pagination } from "@/components/ui/pagination";
import { useToast } from "@/components/ui/toast";
import { fmt, fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";

interface KardexItem {
  id: string;
  producto_id: number;
  fecha: string;
  tipo: "Entrada" | "Salida" | "Ajuste";
  motivo: string | null;
  referencia_tipo: string | null;
  referencia_id: string | null;
  cantidad: number;
  costo_unit: number | string;
  costo_unit_base: number | string;
  saldo_anterior: number;
  saldo_actual: number;
  producto_nombre: string;
  producto_codigo: string;
  // Moneda propia del producto: `costo_unit` se guarda en esa moneda
  producto_moneda_codigo?: string | null;
  producto_moneda_simbolo?: string | null;
}

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface Stats {
  entradas: number;
  salidas: number;
  ajustes: number;
}

const PAGE_SIZE = 20;

export default function KardexPage() {
  const { toast } = useToast();

  const [movimientos, setMovimientos] = useState<KardexItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tipoFilter, setTipoFilter] = useState<string>("todos");
  const [pagination, setPagination] = useState<PaginationInfo>({ page: 1, limit: PAGE_SIZE, total: 0, totalPages: 0 });
  const [currentPage, setCurrentPage] = useState(1);
  const [stats, setStats] = useState<Stats>({ entradas: 0, salidas: 0, ajustes: 0 });

  // Sorting
  const [sortKey, setSortKey] = useState<string>("fecha");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(currentPage),
        limit: String(PAGE_SIZE),
        search,
        tipo: tipoFilter,
        sortKey,
        sortOrder,
      });
      const res = await fetch(`/api/kardex?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setMovimientos(Array.isArray(data) ? data : data.movimientos || []);
        setPagination(data.pagination || { page: 1, limit: PAGE_SIZE, total: 0, totalPages: 0 });
        if (data.stats) setStats(data.stats);
      }
    } catch (error) {
      console.error("Error fetching kardex:", error);
    } finally {
      setLoading(false);
    }
  }, [currentPage, search, tipoFilter, sortKey, sortOrder]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortOrder("asc");
    }
    setCurrentPage(1);
  };

  const headers: HeaderConfig[] = [
    { key: "fecha", label: "Fecha/Hora", sortable: true },
    { key: "producto_codigo", label: "Código", sortable: true },
    { key: "producto_nombre", label: "Producto", sortable: true },
    { key: "tipo", label: "Tipo", sortable: true },
    { key: "motivo", label: "Motivo", sortable: true },
    { key: "cantidad", label: "Cantidad", sortable: true },
    { key: "costo_unit", label: "Costo Unit.", sortable: true },
    { key: "saldo_anterior", label: "Saldo Ant.", sortable: true },
    { key: "saldo_actual", label: "Saldo Act.", sortable: true },
  ];

  const handleExportExcel = async () => {
    try {
      const params = new URLSearchParams({
        page: "1",
        limit: "1000",
        search,
        tipo: tipoFilter,
        sortKey,
        sortOrder,
      });
      const res = await fetch(`/api/kardex?${params.toString()}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      const exportadas: KardexItem[] = data.movimientos || [];

      if (exportadas.length === 0) {
        toast("No hay movimientos para exportar", "warning");
        return;
      }

      const rows = exportadas.map((k) => ({
        Fecha: fmtDateTime(k.fecha),
        Código: k.producto_codigo,
        Producto: k.producto_nombre,
        Tipo: k.tipo,
        Motivo: k.motivo || "N/A",
        Cantidad: k.cantidad,
        "Costo Unit.": parseFloat(String(k.costo_unit)),
        "Saldo Anterior": k.saldo_anterior,
        "Saldo Actual": k.saldo_actual,
      }));

      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Kardex");
      XLSX.writeFile(workbook, `kardex_${new Date().toISOString().slice(0, 10)}.xlsx`);

      const total = data.pagination?.total ?? exportadas.length;
      if (total > exportadas.length) {
        toast(`Exportados ${exportadas.length} de ${total} movimientos`, "warning");
      } else {
        toast("Archivo Excel descargado", "success");
      }
    } catch {
      toast("Error al exportar el kardex", "error");
    }
  };

  return (
    <div>
      <PageHeader
        title="Kardex"
        subtitle="Registro de movimientos de inventario"
        action={
          <Link href="/kardex/ajuste">
            <Button>
              <Plus size={16} className="mr-2" />
              Nuevo Ajuste
            </Button>
          </Link>
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Entradas Totales"
          value={`${stats.entradas} uds.`}
          icon={ArrowDown}
          variant="success"
        />
        <StatCard
          label="Salidas Totales"
          value={`${stats.salidas} uds.`}
          icon={ArrowUp}
          variant="danger"
        />
        <StatCard
          label="Ajustes de Inventario"
          value={`${stats.ajustes} mov.`}
          icon={RefreshCw}
          variant="purple"
        />
      </div>

      <div className="mb-4 flex flex-wrap gap-3">
        <SearchBar
          placeholder="Buscar producto, código o motivo..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setCurrentPage(1);
          }}
        />
        <Select
          value={tipoFilter}
          onChange={(e) => {
            setTipoFilter(e.target.value);
            setCurrentPage(1);
          }}
          className="w-44 bg-card"
          aria-label="Tipo de movimiento"
        >
          <option value="todos">Todos los tipos</option>
          <option value="Entrada">Entrada (+)</option>
          <option value="Salida">Salida (-)</option>
          <option value="Ajuste">Ajuste (⟳)</option>
        </Select>
        <button
          onClick={handleExportExcel}
          className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
        >
          <Download size={13} /> Exportar Excel
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          Cargando movimientos del Kardex...
        </div>
      ) : movimientos.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
          <p className="text-lg font-medium text-foreground">
            {search || tipoFilter !== "todos" ? "No se encontraron movimientos" : "No hay movimientos registrados"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {search || tipoFilter !== "todos"
              ? "Prueba con otro filtro o búsqueda"
              : "Los movimientos se registrarán al comprar, vender o ajustar inventario"}
          </p>
        </div>
      ) : (
        <>
        <Table headers={headers} sortKey={sortKey} sortOrder={sortOrder} onSort={handleSort}>
          {movimientos.map((k) => (
            <Tr key={k.id}>
              <Td mono>{fmtDateTime(k.fecha)}</Td>
              <Td mono>{k.producto_codigo}</Td>
              <Td>
                <span className="font-semibold">{k.producto_nombre}</span>
              </Td>
              <Td>
                <div
                  className={cn(
                    "flex items-center gap-1.5 text-xs font-semibold",
                    k.tipo === "Entrada"
                      ? "text-emerald-400"
                      : k.tipo === "Salida"
                      ? "text-rose-400"
                      : "text-purple-400"
                  )}
                >
                  {k.tipo === "Entrada" ? (
                    <ArrowDown size={12} />
                  ) : k.tipo === "Salida" ? (
                    <ArrowUp size={12} />
                  ) : (
                    <RefreshCw size={12} />
                  )}
                  {k.tipo}
                </div>
              </Td>
              <Td>{k.motivo || "—"}</Td>
              <Td>
                <span
                  className={cn(
                    "font-mono font-semibold",
                    k.cantidad > 0 ? "text-emerald-400" : "text-rose-400"
                  )}
                >
                  {k.cantidad > 0 ? "+" : ""}{k.cantidad}
                </span>
              </Td>
              <Td mono>{fmt(k.costo_unit, k.producto_moneda_codigo || "USD")}</Td>
              <Td mono>{k.saldo_anterior}</Td>
              <Td>
                <span className="font-mono font-bold text-foreground">{k.saldo_actual}</span>
              </Td>
            </Tr>
          ))}
        </Table>

        <Pagination
          currentPage={pagination.page}
          totalPages={pagination.totalPages}
          totalItems={pagination.total}
          pageSize={pagination.limit}
          noun="movimientos"
          onPageChange={setCurrentPage}
        />
        </>
      )}
    </div>
  );
}

"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, RefreshCw, Download, Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { SearchBar } from "@/components/ui/search-bar";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { StatCard } from "@/components/ui/stat-card";
import { Table, Td, Tr, HeaderConfig } from "@/components/ui/table";
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

export default function KardexPage() {
  const { toast } = useToast();

  const [movimientos, setMovimientos] = useState<KardexItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tipoFilter, setTipoFilter] = useState<string>("todos");

  // Sorting
  const [sortKey, setSortKey] = useState<string>("fecha");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/kardex");
      if (res.ok) {
        const data = await res.json();
        setMovimientos(Array.isArray(data) ? data : data.movimientos || []);
      }
    } catch (error) {
      console.error("Error fetching kardex:", error);
    } finally {
      setLoading(false);
    }
  }, []);

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
  };

  const filtered = useMemo(() => {
    let list = movimientos;

    if (tipoFilter !== "todos") {
      list = list.filter((k) => k.tipo === tipoFilter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (k) =>
          k.producto_nombre.toLowerCase().includes(q) ||
          k.producto_codigo.toLowerCase().includes(q) ||
          (k.motivo && k.motivo.toLowerCase().includes(q))
      );
    }

    if (sortKey) {
      list = [...list].sort((a, b) => {
        let aVal: any = a[sortKey as keyof KardexItem];
        let bVal: any = b[sortKey as keyof KardexItem];

        if (["cantidad", "costo_unit", "saldo_anterior", "saldo_actual"].includes(sortKey)) {
          aVal = parseFloat(String(aVal));
          bVal = parseFloat(String(bVal));
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
  }, [movimientos, search, tipoFilter, sortKey, sortOrder]);

  // Statistics
  const stats = useMemo(() => {
    const entradas = movimientos.filter((m) => m.tipo === "Entrada").reduce((acc, m) => acc + Math.abs(m.cantidad), 0);
    const salidas = movimientos.filter((m) => m.tipo === "Salida").reduce((acc, m) => acc + Math.abs(m.cantidad), 0);
    const ajustes = movimientos.filter((m) => m.tipo === "Ajuste").length;

    return { entradas, salidas, ajustes };
  }, [movimientos]);

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

  const handleExportExcel = () => {
    if (filtered.length === 0) {
      toast("No hay movimientos para exportar", "warning");
      return;
    }

    const rows = filtered.map((k) => ({
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
    toast("Archivo Excel descargado", "success");
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
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          value={tipoFilter}
          onChange={(e) => setTipoFilter(e.target.value)}
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
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
          <p className="text-lg font-medium text-foreground">No hay movimientos registrados</p>
          <p className="mt-1 text-sm text-muted-foreground">Los movimientos se registrarán al comprar, vender o ajustar inventario</p>
        </div>
      ) : (
        <Table headers={headers} sortKey={sortKey} sortOrder={sortOrder} onSort={handleSort}>
          {filtered.map((k) => (
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
      )}
    </div>
  );
}

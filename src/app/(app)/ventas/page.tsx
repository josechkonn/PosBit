"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Plus, Eye, Trash2, Download, Filter, RotateCcw, DollarSign, Check } from "lucide-react";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { SearchBar } from "@/components/ui/search-bar";
import { Table, Td, Tr, HeaderConfig } from "@/components/ui/table";
import { VentaDetailModal } from "@/components/venta/venta-detail-modal";
import { VentaPagoModal } from "@/components/venta/venta-pago-modal";
import { RetornoDirectoModal } from "@/components/retorno/retorno-directo-modal";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { fmt, fmtDate, fmtHora } from "@/lib/format";
import { Pagination } from "@/components/ui/pagination";
import * as XLSX from "xlsx";

interface Venta {
  id: string;
  numero: string;
  cliente: string | null;
  cliente_id: string | null;
  cliente_nombre: string | null;
  tipo_pago: string | null;
  fecha: string;
  creado_en: string;
  moneda_id: string;
  moneda_codigo: string;
  moneda_simbolo: string;
  metodo_pago_nombre: string | null;
  caja_nombre: string | null;
  subtotal: number | string;
  impuesto: number | string;
  total: number | string;
  total_base: number | string;
  estado: string;
  observaciones: string | null;
  items_count: number | string;
  credito_id?: string | null;
  credito_numero?: string | null;
  credito_monto_total?: number | string | null;
  credito_saldo?: number | string | null;
  credito_estado?: string | null;
}

interface VentaItem {
  id: string;
  venta_id: string;
  producto_id: number;
  producto_nombre: string;
  producto_codigo: string;
  cantidad: number;
  precio_unit: number | string;
  precio_unit_base: number | string;
  subtotal: number | string;
  subtotal_base: number | string;
}

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore?: boolean;
}

const PAGE_SIZE = 25;

export default function VentasPage() {
  const router = useRouter();
  const { toast } = useToast();
  const confirm = useConfirm();

  const [ventas, setVentas] = useState<Venta[]>([]);
  const [allItems, setAllItems] = useState<VentaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    limit: PAGE_SIZE,
    total: 0,
    totalPages: 1,
  });

  // Detail modal
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedVenta, setSelectedVenta] = useState<Venta | null>(null);

  // Retorno modal
  const [retornoOpen, setRetornoOpen] = useState(false);
  const [retornoVenta, setRetornoVenta] = useState<Venta | null>(null);

  // Pago / Abono modal
  const [pagoOpen, setPagoOpen] = useState(false);
  const [pagoVenta, setPagoVenta] = useState<Venta | null>(null);

  // Sorting
  const [sortKey, setSortKey] = useState<string>("fecha");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const fetchData = useCallback(async (page = 1, query = "") => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("limit", String(PAGE_SIZE));
      if (query.trim()) {
        params.set("search", query.trim());
      }
      const res = await fetch(`/api/ventas?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setVentas(data.ventas || []);
        setAllItems(data.items || []);
        if (data.pagination) {
          setPagination(data.pagination);
        }
      }
    } catch (error) {
      console.error("Error fetching ventas:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchData(currentPage, search);
    }, 250);
    return () => clearTimeout(timer);
  }, [currentPage, search, fetchData]);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortOrder("asc");
    }
  };

  const filteredVentas = useMemo(() => {
    let list = ventas;

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (v) =>
          v.numero.toLowerCase().includes(q) ||
          (v.cliente && v.cliente.toLowerCase().includes(q)) ||
          (v.metodo_pago_nombre && v.metodo_pago_nombre.toLowerCase().includes(q)) ||
          (v.caja_nombre && v.caja_nombre.toLowerCase().includes(q))
      );
    }

    if (sortKey) {
      list = [...list].sort((a, b) => {
        // `fecha` es solo el día: para ordenar por hora (ventas del mismo día)
        // se desempata con `creado_en`, el momento real de la venta.
        if (sortKey === "fecha") {
          let diff =
            (Date.parse(String(a.fecha ?? "")) || 0) - (Date.parse(String(b.fecha ?? "")) || 0);
          if (diff === 0) {
            diff =
              (Date.parse(String(a.creado_en ?? "")) || 0) -
              (Date.parse(String(b.creado_en ?? "")) || 0);
          }
          return sortOrder === "asc" ? diff : -diff;
        }

        let aVal: any = a[sortKey as keyof Venta];
        let bVal: any = b[sortKey as keyof Venta];

        if (["total", "subtotal", "total_base", "items_count", "impuesto"].includes(sortKey)) {
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
  }, [ventas, search, sortKey, sortOrder]);

  const headers: HeaderConfig[] = [
    { key: "numero", label: "N° Venta", sortable: true },
    { key: "cliente", label: "Cliente", sortable: true },
    { key: "tipo_pago", label: "Tipo", sortable: true },
    { key: "fecha", label: "Fecha", sortable: true },
    { key: "items_count", label: "Ítems", sortable: true },
    { key: "total", label: "Total", sortable: true },
    { key: "metodo_pago_nombre", label: "Método Pago", sortable: true },
    { key: "estado", label: "Estado", sortable: true },
    "Retorno",
    "Acciones",
  ];

  const handleExportExcel = () => {
    if (filteredVentas.length === 0) {
      toast("No hay ventas para exportar", "warning");
      return;
    }

    const rows = filteredVentas.map((v) => ({
      "N° Venta": v.numero,
      Cliente: v.cliente || "Consumidor Final",
      Fecha: fmtDate(v.fecha),
      Ítems: v.items_count,
      Total: parseFloat(String(v.total)),
      Moneda: v.moneda_codigo,
      "Método de Pago": v.metodo_pago_nombre || "N/A",
      Estado: v.tipo_pago === "Credito" && parseFloat(String(v.credito_saldo ?? 0)) > 0.009 ? "Pendiente" : v.estado,
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Ventas");
    XLSX.writeFile(workbook, `ventas_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast("Archivo Excel descargado", "success");
  };

  const openDetail = (venta: Venta) => {
    setSelectedVenta(venta);
    setDetailOpen(true);
  };

  const openPago = (venta: Venta) => {
    setPagoVenta(venta);
    setPagoOpen(true);
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/ventas?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        toast("Venta eliminada/anulada exitosamente", "success");
        setDetailOpen(false);
        fetchData(currentPage, search);
      } else {
        const data = await res.json();
        toast(data.error || "Error al eliminar", "error");
      }
    } catch {
      toast("Error al eliminar venta", "error");
    }
  };

  const selectedItems = useMemo(() => {
    if (!selectedVenta) return [];
    return allItems.filter((i) => i.venta_id === selectedVenta.id);
  }, [selectedVenta, allItems]);

  // Cobros extra (delivery, bolsa, propina...) agrupados por venta
  const selectedCobrosExtra = useMemo(() => {
    if (!selectedVenta) return [];
    return (selectedVenta as any).cobros_extra ?? [];
  }, [selectedVenta]);

  const retornoItems = useMemo(() => {
    if (!retornoVenta) return [];
    return allItems.filter((i) => i.venta_id === retornoVenta.id).map((i) => ({
      producto_id: i.producto_id ?? 0,
      producto_nombre: i.producto_nombre,
      producto_codigo: i.producto_codigo,
      cantidad: i.cantidad,
      precio_unit: i.precio_unit,
      precio_unit_base: i.precio_unit_base,
    }));
  }, [retornoVenta, allItems]);

  const openRetorno = (venta: Venta) => {
    setRetornoVenta(venta);
    setRetornoOpen(true);
  };

  return (
    <div>
      <PageHeader
        title="Ventas"
        subtitle="Registro de ventas realizadas"
        action={
          <Button onClick={() => router.push("/pos")}>
            <Plus size={14} /> Nueva Venta
          </Button>
        }
      />

      <div className="mb-4 flex gap-3">
        <SearchBar
          placeholder="Buscar por factura, cliente o método..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setCurrentPage(1);
          }}
        />
        <Button variant="outline" onClick={handleExportExcel}>
          <Download size={13} /> Exportar Excel
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          Cargando...
        </div>
      ) : filteredVentas.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
          <p className="text-lg font-medium text-foreground">
            {search ? "No se encontraron resultados" : "No hay ventas registradas"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {search ? "Intenta con otra búsqueda" : "Realiza tu primera venta desde el Punto de Venta"}
          </p>
          <Button variant="outline" className="mt-4" onClick={() => router.push("/pos")}>
            <Plus size={14} /> Ir a Punto de Venta
          </Button>
        </div>
      ) : (
        <Table headers={headers} sortKey={sortKey} sortOrder={sortOrder} onSort={handleSort}>
          {filteredVentas.map((v) => (
            <Tr key={v.id}>
              <Td mono>{v.numero}</Td>
              <Td>
                <span className="font-medium">{v.cliente_nombre || v.cliente || "Consumidor Final"}</span>
              </Td>
              <Td>
                <StatusBadge status={v.tipo_pago === "Credito" ? "Crédito" : "Contado"} size="pill" />
              </Td>
              <Td>
                <div className="leading-tight">
                  <div className="whitespace-nowrap">{fmtDate(v.fecha)}</div>
                  <div className="text-[11px] text-muted-foreground">{fmtHora(v.creado_en)}</div>
                </div>
              </Td>
              <Td>
                <span className="font-mono">{v.items_count}</span>
              </Td>
              <Td>
                <span className="font-mono font-semibold">{fmt(v.total, v.moneda_codigo)}</span>
              </Td>
              <Td>{v.metodo_pago_nombre || "—"}</Td>
              <Td>
                {v.estado === "Anulada" ? (
                  <StatusBadge status={v.estado} size="pill" />
                ) : v.tipo_pago === "Credito" && parseFloat(String(v.credito_saldo ?? 0)) > 0.009 ? (
                  <button
                    type="button"
                    onClick={() => openPago(v)}
                    className="inline-flex items-center gap-1.5 rounded-full bg-red-600 hover:bg-red-700 active:scale-95 text-white text-xs font-bold px-3.5 py-1.5 shadow-sm transition-all cursor-pointer"
                    title={`Abonar a la venta (Saldo: ${fmt(parseFloat(String(v.credito_saldo ?? 0)), v.moneda_codigo)})`}
                  >
                    <DollarSign size={13} />
                    Pagar
                  </button>
                ) : (
                  <StatusBadge status="Pagada" size="pill" icon={<Check size={13} />} />
                )}
              </Td>
              <Td>
                <button
                  type="button"
                  onClick={() => openRetorno(v)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-bold text-muted-foreground shadow-sm transition-all hover:bg-accent hover:text-foreground active:scale-95 cursor-pointer"
                  title="Retornar productos"
                  aria-label="Retornar productos"
                >
                  <RotateCcw size={13} />
                  Retornar
                </button>
              </Td>
              <Td>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" onClick={() => openDetail(v)} aria-label="Ver">
                    <Eye size={14} />
                  </Button>
                  <Button
                    variant="destructive"
                    size="icon"
                    onClick={async () => {
                      if (await confirm({ 
                        title: "Eliminar Venta", 
                        message: `¿Eliminar/anular venta ${v.numero}?`, 
                        variant: "destructive" 
                      })) {
                        handleDelete(v.id);
                      }
                    }}
                    aria-label="Eliminar"
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              </Td>
            </Tr>
          ))}
        </Table>
      )}

      {!loading && (
        <Pagination
          currentPage={pagination.page}
          totalPages={pagination.totalPages}
          totalItems={pagination.total}
          pageSize={pagination.limit}
          noun="ventas"
          onPageChange={(p) => setCurrentPage(p)}
        />
      )}

      <VentaDetailModal
        open={detailOpen}
        venta={selectedVenta}
        items={selectedItems}
        cobrosExtra={selectedCobrosExtra}
        onClose={() => {
          setDetailOpen(false);
          setSelectedVenta(null);
        }}
        onDelete={handleDelete}
      />

      <RetornoDirectoModal
        open={retornoOpen}
        tipo="Cliente"
        referenciaId={retornoVenta?.id ?? null}
        referenciaNumero={retornoVenta?.numero ?? ""}
        clienteId={retornoVenta?.cliente_id ?? null}
        tipoPago={retornoVenta?.tipo_pago}
        items={retornoItems}
        monedaCodigo={retornoVenta?.moneda_codigo}
        onClose={() => {
          setRetornoOpen(false);
          setRetornoVenta(null);
        }}
        onSuccess={(msg) => {
          setRetornoOpen(false);
          setRetornoVenta(null);
          fetchData(currentPage, search);
          toast(msg, "success");
        }}
      />

      <VentaPagoModal
        open={pagoOpen}
        venta={pagoVenta}
        onClose={() => {
          setPagoOpen(false);
          setPagoVenta(null);
        }}
        onSuccess={() => {
          fetchData(currentPage, search);
        }}
      />
    </div>
  );
}

"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Plus, Eye, Trash2, Download, Filter, RotateCcw, DollarSign } from "lucide-react";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { SearchBar } from "@/components/ui/search-bar";
import { Table, Td, Tr, HeaderConfig } from "@/components/ui/table";
import { VentaDetailModal } from "@/components/venta/venta-detail-modal";
import { RetornoDirectoModal } from "@/components/retorno/retorno-directo-modal";
import { AbonoModal } from "@/components/credito/abono-modal";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { fmt, fmtDate } from "@/lib/format";
import * as XLSX from "xlsx";

interface Venta {
  id: string;
  numero: string;
  cliente: string | null;
  cliente_id: string | null;
  cliente_nombre: string | null;
  tipo_pago: string | null;
  fecha: string;
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

export default function VentasPage() {
  const router = useRouter();
  const { toast } = useToast();
  const confirm = useConfirm();

  const [ventas, setVentas] = useState<Venta[]>([]);
  const [allItems, setAllItems] = useState<VentaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Detail modal
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedVenta, setSelectedVenta] = useState<Venta | null>(null);

  // Retorno modal
  const [retornoOpen, setRetornoOpen] = useState(false);
  const [retornoVenta, setRetornoVenta] = useState<Venta | null>(null);

  // Abono modal
  const [abonoOpen, setAbonoOpen] = useState(false);
  const [abonoCredito, setAbonoCredito] = useState<any>(null);

  // Sorting
  const [sortKey, setSortKey] = useState<string>("fecha");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ventas");
      if (res.ok) {
        const data = await res.json();
        setVentas(data.ventas || []);
        setAllItems(data.items || []);
      }
    } catch (error) {
      console.error("Error fetching ventas:", error);
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
    "Moneda",
    { key: "metodo_pago_nombre", label: "Método Pago", sortable: true },
    { key: "caja_nombre", label: "Caja", sortable: true },
    { key: "estado", label: "Estado", sortable: true },
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
      Caja: v.caja_nombre || "N/A",
      Estado: v.estado,
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

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/ventas?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        toast("Venta eliminada/anulada exitosamente", "success");
        setDetailOpen(false);
        fetchData();
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
          onChange={(e) => setSearch(e.target.value)}
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
                <StatusBadge status={v.tipo_pago === "Credito" ? "Crédito" : "Contado"} />
              </Td>
              <Td>{fmtDate(v.fecha)}</Td>
              <Td>
                <span className="font-mono">{v.items_count}</span>
              </Td>
              <Td>
                <span className="font-mono font-semibold">{fmt(v.total, v.moneda_codigo)}</span>
              </Td>
              <Td>
                <Badge label={`${v.moneda_simbolo} ${v.moneda_codigo}`} variant="info" />
              </Td>
              <Td>{v.metodo_pago_nombre || "—"}</Td>
              <Td>{v.caja_nombre || "—"}</Td>
              <Td>
                <StatusBadge status={v.estado} />
              </Td>
              <Td>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" onClick={() => openDetail(v)} aria-label="Ver">
                    <Eye size={14} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => openRetorno(v)}
                    aria-label="Retornar"
                    title="Retornar productos"
                  >
                    <RotateCcw size={14} />
                  </Button>
                  {v.credito_id && parseFloat(String(v.credito_saldo ?? 0)) > 0 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-emerald-500 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                      onClick={() => {
                        setAbonoCredito({
                          id: v.credito_id,
                          numero: v.credito_numero || "",
                          cliente_id: v.cliente_id || 0,
                          cliente_nombre: v.cliente_nombre || v.cliente || "",
                          venta_numero: v.numero,
                          fecha: v.fecha,
                          monto_total: v.credito_monto_total || v.total,
                          saldo: v.credito_saldo || 0,
                          abonado: parseFloat(String(v.credito_monto_total || v.total)) - parseFloat(String(v.credito_saldo || 0)),
                          estado: v.credito_estado || "Pendiente",
                          moneda_id: v.moneda_id,
                          moneda_codigo: v.moneda_codigo,
                          moneda_simbolo: v.moneda_simbolo,
                        });
                        setAbonoOpen(true);
                      }}
                      aria-label="Abonar"
                      title="Registrar Abono"
                    >
                      <DollarSign size={14} />
                    </Button>
                  )}
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

      <VentaDetailModal
        open={detailOpen}
        venta={selectedVenta}
        items={selectedItems}
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
          fetchData();
          toast(msg, "success");
        }}
      />

      <AbonoModal
        open={abonoOpen}
        credito={abonoCredito}
        onClose={() => {
          setAbonoOpen(false);
          setAbonoCredito(null);
        }}
        onSuccess={(msg) => {
          setAbonoOpen(false);
          setAbonoCredito(null);
          fetchData();
          toast(msg, "success");
        }}
      />
    </div>
  );
}

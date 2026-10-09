"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Plus, Eye, Trash2, RotateCcw } from "lucide-react";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { Table, Td, Tr, HeaderConfig } from "@/components/ui/table";
import { CompraDetailModal } from "@/components/compra/compra-detail-modal";
import { RetornoDirectoModal } from "@/components/retorno/retorno-directo-modal";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { fmt, fmtDate } from "@/lib/format";

interface Compra {
  id: string;
  numero: string;
  proveedor_id: string;
  proveedor_nombre: string;
  fecha: string;
  moneda_codigo: string;
  moneda_simbolo: string;
  metodo_pago_nombre: string | null;
  caja_nombre: string | null;
  subtotal: number | string;
  total: number | string;
  total_base: number | string;
  estado: string;
  observaciones: string | null;
  referencia: string | null;
  items_count: number | string;
}

interface CompraItem {
  id: string;
  compra_id: string;
  producto_id: number;
  producto_nombre: string;
  producto_codigo: string;
  cantidad: number;
  costo_unit: number | string;
  costo_unit_base: number | string;
  subtotal: number | string;
  subtotal_base: number | string;
}

export default function ComprasPage() {
  const router = useRouter();
  const { toast } = useToast();
  const confirm = useConfirm();

  const [compras, setCompras] = useState<Compra[]>([]);
  const [allItems, setAllItems] = useState<CompraItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Detail modal
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedCompra, setSelectedCompra] = useState<Compra | null>(null);

  // Retorno modal
  const [retornoOpen, setRetornoOpen] = useState(false);
  const [retornoCompra, setRetornoCompra] = useState<Compra | null>(null);

  // Sorting
  const [sortKey, setSortKey] = useState<string>("fecha");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/compras");
      if (res.ok) {
        const data = await res.json();
        setCompras(data.compras || []);
        setAllItems(data.items || []);
      }
    } catch (error) {
      console.error("Error fetching compras:", error);
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

  const sortedCompras = useMemo(() => {
    if (!sortKey) return compras;

    return [...compras].sort((a, b) => {
      let aVal: any = a[sortKey as keyof Compra];
      let bVal: any = b[sortKey as keyof Compra];

      if (["total", "subtotal", "total_base", "items_count"].includes(sortKey)) {
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
  }, [compras, sortKey, sortOrder]);

  const headers: HeaderConfig[] = [
    { key: "numero", label: "N° Orden", sortable: true },
    { key: "proveedor_nombre", label: "Proveedor", sortable: true },
    { key: "fecha", label: "Fecha", sortable: true },
    { key: "items_count", label: "Ítems", sortable: true },
    { key: "total", label: "Total", sortable: true },
    "Moneda",
    { key: "metodo_pago_nombre", label: "Método Pago", sortable: true },
    { key: "estado", label: "Estado", sortable: true },
    "Acciones",
  ];

  const openDetail = (compra: Compra) => {
    setSelectedCompra(compra);
    setDetailOpen(true);
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/compras?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        toast("Compra eliminada exitosamente", "success");
        setDetailOpen(false);
        fetchData();
      } else {
        const data = await res.json();
        toast(data.error || "Error al eliminar", "error");
      }
    } catch {
      toast("Error al eliminar compra", "error");
    }
  };

  const selectedItems = useMemo(() => {
    if (!selectedCompra) return [];
    return allItems.filter((i) => i.compra_id === selectedCompra.id);
  }, [selectedCompra, allItems]);

  const retornoItems = useMemo(() => {
    if (!retornoCompra) return [];
    return allItems.filter((i) => i.compra_id === retornoCompra.id).map((i) => ({
      producto_id: i.producto_id,
      producto_nombre: i.producto_nombre,
      producto_codigo: i.producto_codigo,
      cantidad: i.cantidad,
      costo_unit: i.costo_unit,
      costo_unit_base: i.costo_unit_base,
    }));
  }, [retornoCompra, allItems]);

  const openRetorno = (compra: Compra) => {
    setRetornoCompra(compra);
    setRetornoOpen(true);
  };

  return (
    <div>
      <PageHeader
        title="Compras"
        subtitle="Órdenes de compra a proveedores"
        action={
          <Button onClick={() => router.push("/compras/nueva")}>
            <Plus size={14} /> Nueva Compra
          </Button>
        }
      />

      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          Cargando...
        </div>
      ) : compras.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
          <p className="text-lg font-medium text-foreground">No hay compras registradas</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Crea tu primera orden de compra para comenzar
          </p>
          <Button variant="outline" className="mt-4" onClick={() => router.push("/compras/nueva")}>
            <Plus size={14} /> Nueva Compra
          </Button>
        </div>
      ) : (
        <Table headers={headers} sortKey={sortKey} sortOrder={sortOrder} onSort={handleSort}>
          {sortedCompras.map((c) => (
            <Tr key={c.id}>
              <Td mono>{c.numero}</Td>
              <Td>
                <span className="font-medium">{c.proveedor_nombre}</span>
              </Td>
              <Td>{fmtDate(c.fecha)}</Td>
              <Td>
                <span className="font-mono">{c.items_count}</span>
              </Td>
              <Td>
                <span className="font-mono font-semibold">{fmt(c.total, c.moneda_codigo)}</span>
              </Td>
              <Td>
                <Badge label={`${c.moneda_simbolo} ${c.moneda_codigo}`} variant="info" />
              </Td>
              <Td>{c.metodo_pago_nombre || "—"}</Td>
              <Td>
                <StatusBadge status={c.estado} />
              </Td>
              <Td>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" onClick={() => openDetail(c)} aria-label="Ver">
                    <Eye size={14} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => openRetorno(c)}
                    aria-label="Devolver"
                    title="Devolver productos al proveedor"
                  >
                    <RotateCcw size={14} />
                  </Button>
                  <Button
                    variant="destructive"
                    size="icon"
                    onClick={async () => {
                      if (await confirm({ 
                        title: "Eliminar Compra", 
                        message: `¿Eliminar compra ${c.numero}?`, 
                        variant: "destructive" 
                      })) {
                        handleDelete(c.id);
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

      <CompraDetailModal
        open={detailOpen}
        compra={selectedCompra}
        items={selectedItems}
        onClose={() => {
          setDetailOpen(false);
          setSelectedCompra(null);
        }}
        onDelete={handleDelete}
      />

      <RetornoDirectoModal
        open={retornoOpen}
        tipo="Proveedor"
        referenciaId={retornoCompra?.id ?? null}
        referenciaNumero={retornoCompra?.numero ?? ""}
        proveedorId={retornoCompra?.proveedor_id ?? null}
        items={retornoItems}
        monedaCodigo={retornoCompra?.moneda_codigo}
        onClose={() => {
          setRetornoOpen(false);
          setRetornoCompra(null);
        }}
        onSuccess={(msg) => {
          setRetornoOpen(false);
          setRetornoCompra(null);
          fetchData();
          toast(msg, "success");
        }}
      />
    </div>
  );
}

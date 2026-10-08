"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Eye, Plus, RotateCcw, Trash2, UsersRound, Truck } from "lucide-react";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Tr, HeaderConfig } from "@/components/ui/table";
import { RetornoModal } from "@/components/retorno/retorno-modal";
import { RetornoDetailModal } from "@/components/retorno/retorno-detail-modal";
import { KpiCard } from "@/components/ui/kpi-card";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { fmt, fmtDate } from "@/lib/format";

interface Retorno {
  id: number;
  numero: string;
  tipo: string;
  venta_numero: string | null;
  compra_numero: string | null;
  cliente_nombre: string | null;
  proveedor_nombre: string | null;
  fecha: string;
  motivo: string | null;
  estado: string;
  items_count: number | string;
  total_base: number | string;
  total_moneda?: number | string;
  moneda_codigo?: string | null;
  moneda_simbolo?: string | null;
}

interface RetornoItem {
  id: number;
  retorno_id: number;
  producto_nombre: string;
  producto_codigo: string;
  cantidad: number;
  subtotal_base: number | string;
  subtotal_moneda?: number | string;
}

interface Summary {
  clientes: string;
  proveedores: string;
  total_items: string;
}

export default function RetornosPage() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [retornos, setRetornos] = useState<Retorno[]>([]);
  const [allItems, setAllItems] = useState<RetornoItem[]>([]);
  const [summary, setSummary] = useState<Summary>({ clientes: "0", proveedores: "0", total_items: "0" });
  const [loading, setLoading] = useState(true);
  const [tipoFilter, setTipoFilter] = useState("Todos");

  const [createOpen, setCreateOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedRetorno, setSelectedRetorno] = useState<Retorno | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/retornos?tipo=${tipoFilter}`);
      if (res.ok) {
        const data = await res.json();
        setRetornos(data.retornos || []);
        setAllItems(data.items || []);
        setSummary(data.summary || { clientes: "0", proveedores: "0", total_items: "0" });
      }
    } catch (error) {
      console.error("Error al obtener retornos:", error);
    } finally {
      setLoading(false);
    }
  }, [tipoFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const openDetail = (retorno: Retorno) => {
    setSelectedRetorno(retorno);
    setDetailOpen(true);
  };

  const handleDelete = async (id: number) => {
    try {
      const res = await fetch(`/api/retornos?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        toast("Retorno eliminado correctamente", "success");
        setDetailOpen(false);
        setSelectedRetorno(null);
        fetchData();
      } else {
        const data = await res.json();
        toast(data.error || "Error al eliminar retorno", "error");
      }
    } catch {
      toast("Error al eliminar retorno", "error");
    }
  };

  const selectedItems = useMemo(() => {
    if (!selectedRetorno) return [];
    return allItems.filter((i) => i.retorno_id === selectedRetorno.id);
  }, [selectedRetorno, allItems]);

  const headers: HeaderConfig[] = [
    { key: "numero", label: "N°", sortable: true },
    { key: "tipo", label: "Tipo", sortable: true },
    "Referencia",
    "Persona",
    { key: "fecha", label: "Fecha", sortable: true },
    { key: "items_count", label: "Ítems", sortable: true },
    { key: "total_moneda", label: "Total", sortable: true },
    { key: "estado", label: "Estado", sortable: true },
    "Acciones",
  ];

  const sorted = useMemo(() => [...retornos], [retornos]);

  return (
    <div>
      <PageHeader
        title="Retornos"
        subtitle="Devoluciones de clientes y devoluciones a proveedores"
        action={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus size={14} /> Nuevo Retorno
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard
          label="Retornos de clientes"
          value={String(summary.clientes)}
          sub="Productos devueltos por clientes"
          icon={UsersRound}
        />
        <KpiCard
          label="Devoluciones a proveedores"
          value={String(summary.proveedores)}
          sub="Productos devueltos al proveedor"
          icon={Truck}
        />
        <KpiCard
          label="Ítems procesados"
          value={String(summary.total_items)}
          sub="Total de unidades movidas"
          icon={RotateCcw}
        />
      </div>

      <div className="mb-4 flex gap-2">
        {["Todos", "Cliente", "Proveedor"].map((t) => (
          <button
            key={t}
            onClick={() => setTipoFilter(t)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              tipoFilter === t
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/70"
            }`}
          >
            {t === "Todos" ? "Todos" : t === "Cliente" ? "Retornos de Cliente" : "Devoluciones a Proveedor"}
          </button>
        ))}
      </div>

      <Table headers={headers}>
        {loading ? (
          <Tr>
            <Td colSpan={9} className="text-center py-8 text-muted-foreground">
              Cargando...
            </Td>
          </Tr>
        ) : sorted.length === 0 ? (
          <Tr>
            <Td colSpan={9} className="text-center py-8 text-muted-foreground">
              {tipoFilter === "Todos"
                ? "No hay retornos registrados"
                : `No hay ${tipoFilter === "Cliente" ? "retornos de clientes" : "devoluciones a proveedores"}`}
            </Td>
          </Tr>
        ) : (
          sorted.map((r) => (
            <Tr key={r.id}>
              <Td mono>{r.numero}</Td>
              <Td>
                <StatusBadge status={r.tipo === "Cliente" ? "Retorno Cliente" : "Devolución Prov."} />
              </Td>
              <Td mono>{r.tipo === "Cliente" ? r.venta_numero || "—" : r.compra_numero || "—"}</Td>
              <Td>
                <span className="font-medium">
                  {r.tipo === "Cliente" ? r.cliente_nombre || "Consumidor Final" : r.proveedor_nombre || "—"}
                </span>
              </Td>
              <Td>{fmtDate(r.fecha)}</Td>
              <Td>
                <span className="font-mono">{r.items_count}</span>
              </Td>
              <Td>
                <span
                  className="font-mono font-semibold"
                  title={`Base: ${fmt(r.total_base, "USD")}`}
                >
                  {fmt(r.total_moneda ?? r.total_base, r.moneda_codigo || "USD")}
                </span>
              </Td>
              <Td>
                <StatusBadge status={r.estado} />
              </Td>
              <Td>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" onClick={() => openDetail(r)} aria-label="Ver">
                    <Eye size={14} />
                  </Button>
                  <Button
                    variant="destructive"
                    size="icon"
                    onClick={async () => {
                      if (await confirm({ 
                        title: "Eliminar Retorno", 
                        message: `¿Eliminar el retorno ${r.numero}?`, 
                        variant: "destructive" 
                      })) {
                        handleDelete(r.id);
                      }
                    }}
                    aria-label="Eliminar"
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              </Td>
            </Tr>
          ))
        )}
      </Table>

      <RetornoModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSuccess={(msg) => {
          setCreateOpen(false);
          fetchData();
          toast(msg, "success");
        }}
      />

      <RetornoDetailModal
        open={detailOpen}
        retorno={selectedRetorno}
        items={selectedItems}
        onClose={() => {
          setDetailOpen(false);
          setSelectedRetorno(null);
        }}
        onDelete={handleDelete}
      />
    </div>
  );
}

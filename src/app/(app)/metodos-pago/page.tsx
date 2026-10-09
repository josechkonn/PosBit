"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Plus } from "lucide-react";
import { ActionButtons } from "@/components/ui/action-buttons";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Tr, HeaderConfig } from "@/components/ui/table";
import { MetodoPagoModal } from "@/components/metodos-pago/metodo-pago-modal";
import { useToast } from "@/components/ui/toast";

interface Caja {
  id: string;
  nombre: string;
  moneda_codigo: string;
  moneda_simbolo: string;
}

interface MetodoPago {
  id: string;
  nombre: string;
  tipo: string;
  caja_id: string | null;
  activo: boolean;
  creado_en: string;
  actualizado_en: string;
  caja_nombre?: string;
  moneda_codigo?: string;
  moneda_simbolo?: string;
}

type ModalMode = "create" | "edit" | "view" | "delete";

export default function MetodosPagoPage() {
  const [metodos, setMetodos] = useState<MetodoPago[]>([]);
  const [cajas, setCajas] = useState<Caja[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode>("create");
  const [selectedMetodo, setSelectedMetodo] = useState<MetodoPago | null>(null);

  // Sorting
  const [sortKey, setSortKey] = useState<string>("nombre");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  const { toast } = useToast();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [resMetodos, resCajas] = await Promise.all([
        fetch("/api/metodos-pago"),
        fetch("/api/cajas"),
      ]);
      if (resMetodos.ok) setMetodos(await resMetodos.json());
      if (resCajas.ok) setCajas(await resCajas.json());
    } catch (error) {
      console.error("Error fetching data:", error);
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

  const sortedMetodos = useMemo(() => {
    if (!sortKey) return metodos;

    return [...metodos].sort((a, b) => {
      let aVal: any = a[sortKey as keyof MetodoPago];
      let bVal: any = b[sortKey as keyof MetodoPago];

      if (aVal === null || aVal === undefined) aVal = "";
      if (bVal === null || bVal === undefined) bVal = "";

      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortOrder === "asc" ? aVal - bVal : bVal - aVal;
      }

      if (typeof aVal === "boolean" && typeof bVal === "boolean") {
        return sortOrder === "asc" ? Number(aVal) - Number(bVal) : Number(bVal) - Number(aVal);
      }

      const comp = String(aVal).localeCompare(String(bVal), undefined, { numeric: true, sensitivity: "base" });
      return sortOrder === "asc" ? comp : -comp;
    });
  }, [metodos, sortKey, sortOrder]);

  const headers: HeaderConfig[] = [
    { key: "id", label: "#", sortable: true },
    { key: "nombre", label: "Nombre", sortable: true },
    { key: "tipo", label: "Tipo", sortable: true },
    { key: "caja_nombre", label: "Caja", sortable: true },
    { key: "moneda_codigo", label: "Moneda", sortable: true },
    { key: "activo", label: "Estado", sortable: true },
    "Acciones",
  ];

  const openModal = (mode: ModalMode, metodo: MetodoPago | null = null) => {
    setModalMode(mode);
    setSelectedMetodo(metodo);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setSelectedMetodo(null);
  };

  const handleSuccess = (message: string) => {
    fetchData();
    toast(message, "success");
  };

  return (
    <div>
      <PageHeader
        title="Métodos de Pago"
        subtitle="Formas de pago disponibles en el sistema"
        action={
          <Button onClick={() => openModal("create")}>
            <Plus size={14} /> Nuevo Método
          </Button>
        }
      />

      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          Cargando...
        </div>
      ) : metodos.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
          <p className="text-lg font-medium text-foreground">No hay métodos de pago</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Crea tu primer método de pago para comenzar
          </p>
          <Button variant="outline" className="mt-4" onClick={() => openModal("create")}>
            <Plus size={14} /> Nuevo Método
          </Button>
        </div>
      ) : (
        <Table
          headers={headers}
          sortKey={sortKey}
          sortOrder={sortOrder}
          onSort={handleSort}
        >
          {sortedMetodos.map((m: MetodoPago) => (
            <Tr key={m.id}>
              <Td mono>{String(m.id).padStart(2, "0")}</Td>
              <Td>
                <span className="font-semibold">{m.nombre}</span>
              </Td>
              <Td>
                <Badge label={m.tipo} variant="info" />
              </Td>
              <Td>
                <span className="text-sm">{m.caja_nombre || "—"}</span>
              </Td>
              <Td>
                {m.moneda_codigo ? (
                  <Badge label={`${m.moneda_simbolo} ${m.moneda_codigo}`} variant="neutral" />
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </Td>
              <Td>
                <StatusBadge status={m.activo ? "Activo" : "Inactivo"} />
              </Td>
              <Td>
                <ActionButtons
                  onView={() => openModal("view", m)}
                  onEdit={() => openModal("edit", m)}
                  onDelete={() => openModal("delete", m)}
                />
              </Td>
            </Tr>
          ))}
        </Table>
      )}

      <MetodoPagoModal
        open={modalOpen}
        mode={modalMode}
        metodo={selectedMetodo}
        cajas={cajas}
        onClose={closeModal}
        onSuccess={handleSuccess}
      />
    </div>
  );
}

"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Plus } from "lucide-react";
import { ActionButtons } from "@/components/ui/action-buttons";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Tr, HeaderConfig } from "@/components/ui/table";
import { MonedaModal } from "@/components/moneda/moneda-modal";
import { useToast } from "@/components/ui/toast";

interface Moneda {
  id: number;
  nombre: string;
  codigo: string;
  simbolo: string;
  tasa: number | string;
  decimales: number;
  es_base: boolean;
  activo: boolean;
  creado_en: string;
  actualizado_en: string;
  cajas_count?: number;
}

type ModalMode = "create" | "edit" | "view" | "delete";

export default function MonedasPage() {
  const [monedas, setMonedas] = useState<Moneda[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode>("create");
  const [selectedMoneda, setSelectedMoneda] = useState<Moneda | null>(null);

  // Sorting
  const [sortKey, setSortKey] = useState<string>("codigo");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  const { toast } = useToast();

  const fetchMonedas = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/monedas");
      if (res.ok) {
        const data = await res.json();
        setMonedas(data);
      }
    } catch (error) {
      console.error("Error al obtener monedas:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMonedas();
  }, [fetchMonedas]);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortOrder("asc");
    }
  };

  const sortedMonedas = useMemo(() => {
    if (!sortKey) return monedas;

    return [...monedas].sort((a, b) => {
      let aVal: any = a[sortKey as keyof Moneda];
      let bVal: any = b[sortKey as keyof Moneda];

      if (sortKey === "tasa") {
        aVal = parseFloat(String(a.tasa));
        bVal = parseFloat(String(b.tasa));
      }

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
  }, [monedas, sortKey, sortOrder]);

  const headers: HeaderConfig[] = [
    { key: "id", label: "#", sortable: true },
    { key: "nombre", label: "Moneda", sortable: true },
    { key: "codigo", label: "Código", sortable: true },
    { key: "simbolo", label: "Símbolo", sortable: true },
    { key: "tasa", label: "Tasa", sortable: true },
    { key: "es_base", label: "Principal", sortable: true },
    { key: "activo", label: "Estado", sortable: true },
    "Acciones",
  ];

  const openModal = (mode: ModalMode, moneda: Moneda | null = null) => {
    setModalMode(mode);
    setSelectedMoneda(moneda);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setSelectedMoneda(null);
  };

  const handleSuccess = (message: string) => {
    fetchMonedas();
    toast(message, "success");
  };

  return (
    <div>
      <PageHeader
        title="Monedas"
        subtitle="Gestión de monedas y tipos de cambio"
        action={
          <Button onClick={() => openModal("create")}>
            <Plus size={14} /> Nueva Moneda
          </Button>
        }
      />

      <Table
        headers={headers}
        sortKey={sortKey}
        sortOrder={sortOrder}
        onSort={handleSort}
      >
        {loading ? (
          <Tr>
            <Td colSpan={8} className="text-center py-8 text-muted-foreground">
              Cargando...
            </Td>
          </Tr>
        ) : sortedMonedas.length === 0 ? (
          <Tr>
            <Td colSpan={8} className="text-center py-8 text-muted-foreground">
              No hay monedas registradas
            </Td>
          </Tr>
        ) : (
          sortedMonedas.map((c: Moneda) => (
            <Tr key={c.id}>
              <Td mono>{String(c.id).padStart(2, "0")}</Td>
              <Td>
                <span className="font-semibold">{c.nombre}</span>
              </Td>
              <Td>
                <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs font-bold">
                  {c.codigo}
                </span>
              </Td>
              <Td>
                <span className="font-mono font-bold text-primary">{c.simbolo}</span>
              </Td>
              <Td>
                <span className="font-mono">{parseFloat(String(c.tasa)).toFixed(4)}</span>
              </Td>
              <Td>
                {c.es_base ? (
                  <Badge label="Base" variant="purple" />
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </Td>
              <Td>
                <StatusBadge status={c.activo ? "Activo" : "Inactivo"} />
              </Td>
              <Td>
                <ActionButtons
                  onView={() => openModal("view", c)}
                  onEdit={() => openModal("edit", c)}
                  onDelete={() => openModal("delete", c)}
                />
              </Td>
            </Tr>
          ))
        )}
      </Table>

      <MonedaModal
        open={modalOpen}
        mode={modalMode}
        moneda={selectedMoneda}
        onClose={closeModal}
        onSuccess={handleSuccess}
      />
    </div>
  );
}

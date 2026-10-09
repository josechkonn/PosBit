"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Plus } from "lucide-react";
import { ActionButtons } from "@/components/ui/action-buttons";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Tr, HeaderConfig } from "@/components/ui/table";
import { MarcaModal } from "@/components/marca/marca-modal";
import { useToast } from "@/components/ui/toast";

interface Marca {
  id: string;
  nombre: string;
  pais: string | null;
  activo: boolean;
  creado_en: string;
  actualizado_en: string;
  productos_count?: number;
}

type ModalMode = "create" | "edit" | "view" | "delete";

export default function MarcasPage() {
  const [marcas, setMarcas] = useState<Marca[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode>("create");
  const [selectedMarca, setSelectedMarca] = useState<Marca | null>(null);

  // Sorting
  const [sortKey, setSortKey] = useState<string>("nombre");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  const { toast } = useToast();

  const fetchMarcas = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/marcas");
      if (res.ok) {
        const data = await res.json();
        setMarcas(data);
      }
    } catch (error) {
      console.error("Error al obtener marcas:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMarcas();
  }, [fetchMarcas]);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortOrder("asc");
    }
  };

  const sortedMarcas = useMemo(() => {
    if (!sortKey) return marcas;

    return [...marcas].sort((a, b) => {
      let aVal: any = a[sortKey as keyof Marca];
      let bVal: any = b[sortKey as keyof Marca];

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
  }, [marcas, sortKey, sortOrder]);

  const headers: HeaderConfig[] = [
    { key: "id", label: "#", sortable: true },
    { key: "nombre", label: "Marca", sortable: true },
    { key: "pais", label: "País de Origen", sortable: true },
    { key: "productos_count", label: "Productos", sortable: true },
    { key: "activo", label: "Estado", sortable: true },
    "Acciones",
  ];

  const openModal = (mode: ModalMode, marca: Marca | null = null) => {
    setModalMode(mode);
    setSelectedMarca(marca);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setSelectedMarca(null);
  };

  const handleSuccess = (message: string) => {
    fetchMarcas();
    toast(message, "success");
  };

  return (
    <div>
      <PageHeader
        title="Marcas"
        subtitle="Registro de marcas de productos"
        action={
          <Button onClick={() => openModal("create")}>
            <Plus size={14} /> Nueva Marca
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
            <Td colSpan={6} className="text-center py-8 text-muted-foreground">
              Cargando...
            </Td>
          </Tr>
        ) : sortedMarcas.length === 0 ? (
          <Tr>
            <Td colSpan={6} className="text-center py-8 text-muted-foreground">
              No hay marcas registradas
            </Td>
          </Tr>
        ) : (
          sortedMarcas.map((b: Marca) => (
            <Tr key={b.id}>
              <Td mono>{String(b.id).padStart(2, "0")}</Td>
              <Td>
                <span className="font-semibold">{b.nombre}</span>
              </Td>
              <Td>{b.pais || "—"}</Td>
              <Td>
                <span className="font-mono font-semibold text-primary">{b.productos_count ?? 0}</span>
              </Td>
              <Td>
                <StatusBadge status={b.activo ? "Activo" : "Inactivo"} />
              </Td>
              <Td>
                <ActionButtons
                  onView={() => openModal("view", b)}
                  onEdit={() => openModal("edit", b)}
                  onDelete={() => openModal("delete", b)}
                />
              </Td>
            </Tr>
          ))
        )}
      </Table>

      <MarcaModal
        open={modalOpen}
        mode={modalMode}
        marca={selectedMarca}
        onClose={closeModal}
        onSuccess={handleSuccess}
      />
    </div>
  );
}

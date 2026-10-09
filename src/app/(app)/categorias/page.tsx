"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Plus } from "lucide-react";
import { ActionButtons } from "@/components/ui/action-buttons";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Tr, HeaderConfig } from "@/components/ui/table";
import { CategoriaModal } from "@/components/categoria/categoria-modal";
import { useToast } from "@/components/ui/toast";

interface Categoria {
  id: string;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  creado_en: string;
  actualizado_en: string;
  productos_count: number;
}

type ModalMode = "create" | "edit" | "view" | "delete";

export default function CategoriasPage() {
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode>("create");
  const [selectedCategoria, setSelectedCategoria] = useState<Categoria | null>(null);

  // Sorting
  const [sortKey, setSortKey] = useState<string>("nombre");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  const { toast } = useToast();

  const fetchCategorias = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/categorias");
      if (res.ok) {
        const data = await res.json();
        setCategorias(data);
      }
    } catch (error) {
      console.error("Error fetching categorias:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCategorias();
  }, [fetchCategorias]);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortOrder("asc");
    }
  };

  const sortedCategorias = useMemo(() => {
    if (!sortKey) return categorias;

    return [...categorias].sort((a, b) => {
      let aVal: any = a[sortKey as keyof Categoria];
      let bVal: any = b[sortKey as keyof Categoria];

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
  }, [categorias, sortKey, sortOrder]);

  const headers: HeaderConfig[] = [
    { key: "nombre", label: "Nombre", sortable: true },
    { key: "descripcion", label: "Descripción", sortable: true },
    { key: "productos_count", label: "Productos", sortable: true },
    { key: "activo", label: "Estado", sortable: true },
    "Acciones",
  ];

  const openModal = (mode: ModalMode, categoria: Categoria | null = null) => {
    setModalMode(mode);
    setSelectedCategoria(categoria);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setSelectedCategoria(null);
  };

  const handleSuccess = (message: string) => {
    fetchCategorias();
    toast(message, "success");
  };

  return (
    <div>
      <PageHeader
        title="Categorías"
        subtitle="Clasificación de productos por categoría"
        action={
          <Button onClick={() => openModal("create")}>
            <Plus size={14} /> Nueva Categoría
          </Button>
        }
      />

      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          Cargando...
        </div>
      ) : categorias.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
          <p className="text-lg font-medium text-foreground">No hay categorías</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Crea tu primera categoría para comenzar
          </p>
          <Button variant="outline" className="mt-4" onClick={() => openModal("create")}>
            <Plus size={14} /> Nueva Categoría
          </Button>
        </div>
      ) : (
        <Table
          headers={headers}
          sortKey={sortKey}
          sortOrder={sortOrder}
          onSort={handleSort}
        >
          {sortedCategorias.map((c: Categoria) => (
            <Tr key={c.id}>
              <Td>
                <span className="font-medium">{c.nombre}</span>
              </Td>
              <Td>{c.descripcion || "—"}</Td>
              <Td>
                <span className="font-mono font-semibold text-primary">{c.productos_count}</span>
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
          ))}
        </Table>
      )}

      <CategoriaModal
        open={modalOpen}
        mode={modalMode}
        categoria={selectedCategoria}
        onClose={closeModal}
        onSuccess={handleSuccess}
      />
    </div>
  );
}

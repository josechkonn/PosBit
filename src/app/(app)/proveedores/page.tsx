"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Plus } from "lucide-react";
import { ActionButtons } from "@/components/ui/action-buttons";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { SearchBar } from "@/components/ui/search-bar";
import { Table, Td, Tr, HeaderConfig } from "@/components/ui/table";
import { ProveedorModal } from "@/components/proveedor/proveedor-modal";
import { useToast } from "@/components/ui/toast";

interface Proveedor {
  id: string;
  nombre: string;
  contacto: string | null;
  email: string | null;
  telefono: string | null;
  ciudad: string | null;
  direccion: string | null;
  rif: string | null;
  activo: boolean;
  creado_en: string;
  actualizado_en: string;
  compras_count?: number;
}

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

type ModalMode = "create" | "edit" | "view" | "delete";

const PAGE_SIZE = 20;

export default function ProveedoresPage() {
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [pagination, setPagination] = useState<PaginationInfo>({ page: 1, limit: PAGE_SIZE, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode>("create");
  const [selectedProveedor, setSelectedProveedor] = useState<Proveedor | null>(null);

  // Sorting
  const [sortKey, setSortKey] = useState<string>("nombre");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  const { toast } = useToast();

  const fetchProveedores = useCallback(async (page: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/proveedores?page=${page}&limit=${PAGE_SIZE}`);
      if (res.ok) {
        const data = await res.json();
        setProveedores(data.data);
        setPagination(data.pagination);
      }
    } catch (error) {
      console.error("Error al obtener proveedores:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProveedores(currentPage);
  }, [currentPage, fetchProveedores]);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortOrder("asc");
    }
  };

  const filteredProveedores = useMemo(() => {
    let list = proveedores;

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) =>
          p.nombre.toLowerCase().includes(q) ||
          (p.contacto && p.contacto.toLowerCase().includes(q)) ||
          (p.email && p.email.toLowerCase().includes(q)) ||
          (p.ciudad && p.ciudad.toLowerCase().includes(q)) ||
          (p.rif && p.rif.toLowerCase().includes(q))
      );
    }

    if (sortKey) {
      list = [...list].sort((a, b) => {
        let aVal: any = a[sortKey as keyof Proveedor];
        let bVal: any = b[sortKey as keyof Proveedor];

        if (aVal === null || aVal === undefined) aVal = "";
        if (bVal === null || bVal === undefined) bVal = "";

        if (typeof aVal === "boolean" && typeof bVal === "boolean") {
          return sortOrder === "asc" ? Number(aVal) - Number(bVal) : Number(bVal) - Number(aVal);
        }

        const comp = String(aVal).localeCompare(String(bVal), undefined, { numeric: true, sensitivity: "base" });
        return sortOrder === "asc" ? comp : -comp;
      });
    }

    return list;
  }, [proveedores, search, sortKey, sortOrder]);

  const headers: HeaderConfig[] = [
    { key: "nombre", label: "Empresa", sortable: true },
    { key: "contacto", label: "Contacto", sortable: true },
    { key: "email", label: "Correo", sortable: true },
    { key: "telefono", label: "Teléfono", sortable: true },
    { key: "ciudad", label: "Ciudad", sortable: true },
    { key: "activo", label: "Estado", sortable: true },
    "Acciones",
  ];

  const openModal = (mode: ModalMode, proveedor: Proveedor | null = null) => {
    setModalMode(mode);
    setSelectedProveedor(proveedor);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setSelectedProveedor(null);
  };

  const handleSuccess = (message: string) => {
    fetchProveedores(currentPage);
    toast(message, "success");
  };

  return (
    <div>
      <PageHeader
        title="Proveedores"
        subtitle="Directorio de proveedores"
        action={
          <Button onClick={() => openModal("create")}>
            <Plus size={14} /> Nuevo Proveedor
          </Button>
        }
      />

      <div className="mb-4">
        <SearchBar
          placeholder="Buscar por nombre, RIF o contacto..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Table
        headers={headers}
        sortKey={sortKey}
        sortOrder={sortOrder}
        onSort={handleSort}
      >
        {loading ? (
          <Tr>
            <Td colSpan={7} className="text-center py-8 text-muted-foreground">
              Cargando...
            </Td>
          </Tr>
        ) : filteredProveedores.length === 0 ? (
          <Tr>
            <Td colSpan={7} className="text-center py-8 text-muted-foreground">
              {search ? "No se encontraron resultados" : "No hay proveedores registrados"}
            </Td>
          </Tr>
        ) : (
          filteredProveedores.map((s: Proveedor) => (
            <Tr key={s.id}>
              <Td>
                <span className="font-semibold">{s.nombre}</span>
              </Td>
              <Td>{s.contacto || "—"}</Td>
              <Td>
                <span className="text-primary">{s.email || "—"}</span>
              </Td>
              <Td mono>{s.telefono || "—"}</Td>
              <Td>{s.ciudad || "—"}</Td>
              <Td>
                <StatusBadge status={s.activo ? "Activo" : "Inactivo"} />
              </Td>
              <Td>
                <ActionButtons
                  onView={() => openModal("view", s)}
                  onEdit={() => openModal("edit", s)}
                  onDelete={() => openModal("delete", s)}
                />
              </Td>
            </Tr>
          ))
        )}
      </Table>

      <Pagination
        currentPage={pagination.page}
        totalPages={pagination.totalPages}
        totalItems={pagination.total}
        pageSize={pagination.limit}
        noun="proveedores"
        onPageChange={setCurrentPage}
      />

      <ProveedorModal
        open={modalOpen}
        mode={modalMode}
        proveedor={selectedProveedor}
        onClose={closeModal}
        onSuccess={handleSuccess}
      />
    </div>
  );
}

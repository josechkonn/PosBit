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
import { ClienteModal } from "@/components/cliente/cliente-modal";
import { useToast } from "@/components/ui/toast";
import { fmt } from "@/lib/format";

interface PorCobrarItem {
  codigo: string;
  simbolo: string;
  monto: number;
}

interface Cliente {
  id: string;
  nombre: string;
  tipo: string;
  documento: string | null;
  email: string | null;
  telefono: string | null;
  ciudad: string | null;
  direccion: string | null;
  recibe_credito: boolean;
  limite_credito: number | string;
  activo: boolean;
  creado_en: string;
  actualizado_en: string;
  deuda_total?: PorCobrarItem[];
  ventas_count?: number;
  retornos_count?: number;
}

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

type ModalMode = "create" | "edit" | "view" | "delete";

const PAGE_SIZE = 20;

export default function ClientesPage() {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [pagination, setPagination] = useState<PaginationInfo>({ page: 1, limit: PAGE_SIZE, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode>("create");
  const [selectedCliente, setSelectedCliente] = useState<Cliente | null>(null);

  const [sortKey, setSortKey] = useState<string>("nombre");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  const { toast } = useToast();

  const fetchClientes = useCallback(async (page: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/clientes?page=${page}&limit=${PAGE_SIZE}`);
      if (res.ok) {
        const data = await res.json();
        setClientes(data.data);
        setPagination(data.pagination);
      }
    } catch (error) {
      console.error("Error al obtener clientes:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchClientes(currentPage);
  }, [currentPage, fetchClientes]);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortOrder("asc");
    }
  };

  const filteredClientes = useMemo(() => {
    let list = clientes;

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (c) =>
          c.nombre.toLowerCase().includes(q) ||
          (c.documento && c.documento.toLowerCase().includes(q)) ||
          (c.email && c.email.toLowerCase().includes(q)) ||
          (c.telefono && c.telefono.toLowerCase().includes(q)) ||
          (c.ciudad && c.ciudad.toLowerCase().includes(q))
      );
    }

    if (sortKey) {
      list = [...list].sort((a, b) => {
        let aVal: any = a[sortKey as keyof Cliente];
        let bVal: any = b[sortKey as keyof Cliente];

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
  }, [clientes, search, sortKey, sortOrder]);

  const headers: HeaderConfig[] = [
    { key: "id", label: "#", sortable: true },
    { key: "nombre", label: "Cliente", sortable: true },
    { key: "tipo", label: "Tipo", sortable: true },
    { key: "documento", label: "Documento", sortable: true },
    { key: "telefono", label: "Teléfono", sortable: true },
    { key: "ciudad", label: "Ciudad", sortable: true },
    { key: "deuda_total", label: "Deuda", sortable: false },
    { key: "activo", label: "Estado", sortable: true },
    "Acciones",
  ];

  const openModal = (mode: ModalMode, cliente: Cliente | null = null) => {
    setModalMode(mode);
    setSelectedCliente(cliente);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setSelectedCliente(null);
  };

  const handleSuccess = (message: string) => {
    fetchClientes(currentPage);
    toast(message, "success");
  };

  return (
    <div>
      <PageHeader
        title="Clientes"
        subtitle="Directorio de clientes, deudas y créditos"
        action={
          <Button onClick={() => openModal("create")}>
            <Plus size={14} /> Nuevo Cliente
          </Button>
        }
      />

      <div className="mb-4">
        <SearchBar
          placeholder="Buscar por nombre, documento o teléfono..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Table headers={headers} sortKey={sortKey} sortOrder={sortOrder} onSort={handleSort}>
        {loading ? (
          <Tr>
            <Td colSpan={9} className="text-center py-8 text-muted-foreground">
              Cargando...
            </Td>
          </Tr>
        ) : filteredClientes.length === 0 ? (
          <Tr>
            <Td colSpan={9} className="text-center py-8 text-muted-foreground">
              {search ? "No se encontraron resultados" : "No hay clientes registrados"}
            </Td>
          </Tr>
        ) : (
          filteredClientes.map((c: Cliente) => {
            return (
              <Tr key={c.id}>
                <Td mono>{String(c.id).padStart(2, "0")}</Td>
                <Td>
                  <span className="font-semibold">{c.nombre}</span>
                </Td>
                <Td>
                  <StatusBadge status={c.tipo || "Persona Natural"} />
                </Td>
                <Td mono>{c.documento || "—"}</Td>
                <Td mono>{c.telefono || "—"}</Td>
                <Td>{c.ciudad || "—"}</Td>
                <Td>
                  {c.deuda_total && c.deuda_total.length > 0 ? (
                    <div className="flex flex-col gap-0.5 font-mono text-sm font-semibold text-danger">
                      {c.deuda_total.map((d) => (
                        <span key={d.codigo}>{fmt(d.monto, d.codigo)}</span>
                      ))}
                    </div>
                  ) : (
                    <span className="font-mono text-muted-foreground">—</span>
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
            );
          })
        )}
      </Table>

      <Pagination
        currentPage={pagination.page}
        totalPages={pagination.totalPages}
        totalItems={pagination.total}
        pageSize={pagination.limit}
        noun="clientes"
        onPageChange={setCurrentPage}
      />

      <ClienteModal
        open={modalOpen}
        mode={modalMode}
        cliente={selectedCliente}
        onClose={closeModal}
        onSuccess={handleSuccess}
      />
    </div>
  );
}

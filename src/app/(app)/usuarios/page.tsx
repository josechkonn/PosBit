"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Plus } from "lucide-react";
import { ActionButtons } from "@/components/ui/action-buttons";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { Table, Td, Tr, HeaderConfig } from "@/components/ui/table";
import { UserModal } from "@/components/usuario/user-modal";
import { fmtDate } from "@/lib/format";
import { useToast } from "@/components/ui/toast";

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
}

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

type ModalMode = "create" | "edit" | "view" | "delete";

const PAGE_SIZE = 20;

export default function UsuariosPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [pagination, setPagination] = useState<PaginationInfo>({ page: 1, limit: PAGE_SIZE, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode>("create");
  const [selectedUser, setSelectedUser] = useState<User | null>(null);

  // Sorting
  const [sortKey, setSortKey] = useState<string>("name");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  const { toast } = useToast();

  const fetchUsers = useCallback(async (page: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/users?page=${page}&limit=${PAGE_SIZE}`);
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users);
        setPagination(data.pagination);
        if (data.currentUserId) setCurrentUserId(data.currentUserId);
      }
    } catch (error) {
      console.error("Error fetching users:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers(currentPage);
  }, [currentPage, fetchUsers]);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortOrder("asc");
    }
  };

  const sortedUsers = useMemo(() => {
    if (!sortKey) return users;

    return [...users].sort((a, b) => {
      let aVal: any = a[sortKey as keyof User];
      let bVal: any = b[sortKey as keyof User];

      if (aVal === null || aVal === undefined) aVal = "";
      if (bVal === null || bVal === undefined) bVal = "";

      const comp = String(aVal).localeCompare(String(bVal), undefined, { numeric: true, sensitivity: "base" });
      return sortOrder === "asc" ? comp : -comp;
    });
  }, [users, sortKey, sortOrder]);

  const headers: HeaderConfig[] = [
    "#",
    { key: "name", label: "Usuario", sortable: true },
    { key: "email", label: "Correo", sortable: true },
    { key: "role", label: "Rol", sortable: true },
    { key: "createdAt", label: "Registro", sortable: true },
    "Acciones",
  ];

  const openModal = (mode: ModalMode, user: User | null = null) => {
    setModalMode(mode);
    setSelectedUser(user);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setSelectedUser(null);
  };

  const getInitials = (name: string) =>
    name
      .split(" ")
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();

  const roleLabels: Record<string, string> = {
    usuario: "Usuario",
    cajero: "Cajero",
    admin: "Administrador",
  };

  const handleSuccess = (message: string) => {
    fetchUsers(currentPage);
    toast(message, "success");
  };

  return (
    <div>
      <PageHeader
        title="Usuarios"
        subtitle="Gestionar usuarios del sistema"
        action={
          <Button onClick={() => openModal("create")}>
            <Plus size={14} /> Nuevo Usuario
          </Button>
        }
      />

      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          Cargando...
        </div>
      ) : users.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
          <p className="text-lg font-medium text-foreground">No hay usuarios</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Crea el primer usuario del sistema
          </p>
          <Button variant="outline" className="mt-4" onClick={() => openModal("create")}>
            <Plus size={14} /> Nuevo Usuario
          </Button>
        </div>
      ) : (
        <>
          <Table
            headers={headers}
            sortKey={sortKey}
            sortOrder={sortOrder}
            onSort={handleSort}
          >
            {sortedUsers.map((u: User, i: number) => (
              <Tr key={u.id}>
                <Td mono>{String((currentPage - 1) * PAGE_SIZE + i + 1).padStart(2, "0")}</Td>
                <Td>
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                      {getInitials(u.name)}
                    </div>
                    <span className="font-medium">{u.name}</span>
                  </div>
                </Td>
                <Td className="text-muted-foreground">{u.email}</Td>
                <Td>
                  <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium capitalize text-muted-foreground">
                    {roleLabels[u.role] || u.role}
                  </span>
                </Td>
                <Td className="text-xs text-muted-foreground">{fmtDate(u.createdAt)}</Td>
                <Td>
                  <ActionButtons
                    onView={() => openModal("view", u)}
                    onEdit={() => openModal("edit", u)}
                    onDelete={() => openModal("delete", u)}
                  />
                </Td>
              </Tr>
            ))}
          </Table>

          <Pagination
            currentPage={pagination.page}
            totalPages={pagination.totalPages}
            totalItems={pagination.total}
            pageSize={pagination.limit}
            noun="usuarios"
            onPageChange={setCurrentPage}
          />
        </>
      )}

      <UserModal
        open={modalOpen}
        mode={modalMode}
        user={selectedUser}
        currentUserId={currentUserId}
        onClose={closeModal}
        onSuccess={handleSuccess}
      />
    </div>
  );
}

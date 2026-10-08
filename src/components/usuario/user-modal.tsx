"use client";

import { useState, useEffect } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label, Field } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { fmtDate } from "@/lib/format";

const ROLES = [
  { value: "usuario", label: "Usuario" },
  { value: "cajero", label: "Cajero" },
  { value: "admin", label: "Administrador" },
];

type UserModalMode = "create" | "edit" | "view" | "delete";

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
}

interface UserModalProps {
  open: boolean;
  mode: UserModalMode;
  user: User | null;
  currentUserId: string | null;
  onClose: () => void;
  onSuccess: (message: string) => void;
}

export function UserModal({ open, mode, user, currentUserId, onClose, onSuccess }: UserModalProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("cajero");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (user && (mode === "edit" || mode === "view")) {
      setName(user.name);
      setEmail(user.email);
      setRole(user.role);
      setPassword("");
    } else if (mode === "create") {
      setName("");
      setEmail("");
      setPassword("");
      setRole("cajero");
    }
    setError("");
  }, [user, mode, open]);

  const handleSubmit = async () => {
    setLoading(true);
    setError("");

    try {
      if (mode === "create") {
        const res = await fetch("/api/admin/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email, password, role }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error al crear usuario");
      } else if (mode === "edit" && user) {
        const body: Record<string, string> = { id: user.id, name, email, role };
        if (password) body.password = password;
        const res = await fetch("/api/admin/users", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error al actualizar usuario");
      } else if (mode === "delete" && user) {
        const res = await fetch("/api/admin/users", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: user.id }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error al eliminar usuario");
      }
      const msgs: Record<string, string> = {
        create: `Usuario "${name}" creado exitosamente`,
        edit: `Usuario "${name}" actualizado exitosamente`,
        delete: `Usuario eliminado exitosamente`,
      };
      onSuccess(msgs[mode] || "Operación exitosa");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  };

  const isFormMode = mode === "create" || mode === "edit";
  const isDeleteMode = mode === "delete";
  const isSelfDelete = mode === "delete" && user?.id === currentUserId;

  const titles: Record<UserModalMode, string> = {
    create: "Nuevo Usuario",
    edit: "Editar Usuario",
    view: "Detalle del Usuario",
    delete: "Eliminar Usuario",
  };

  const roleLabel = ROLES.find((r) => r.value === role)?.label || role;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={titles[mode]}
      className="max-w-lg w-[90vw]"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={loading} className="flex-1">
            {isFormMode || isDeleteMode ? "Cancelar" : "Cerrar"}
          </Button>
          {(isFormMode || isDeleteMode) && (
            <Button
              variant={isDeleteMode ? "destructive" : "primary"}
              onClick={handleSubmit}
              disabled={loading || isSelfDelete || (isFormMode && (!name.trim() || !email.trim()))}
              className="flex-1"
            >
              {loading
                ? "Guardando..."
                : mode === "create"
                  ? "Crear"
                  : mode === "edit"
                    ? "Guardar"
                    : "Eliminar"}
            </Button>
          )}
        </>
      }
    >
      {error && (
        <div className="rounded-lg border border-danger/20 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      {mode === "view" && user && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
              {user.name
                .split(" ")
                .map((w) => w[0])
                .join("")
                .slice(0, 2)
                .toUpperCase()}
            </div>
            <div>
              <p className="font-medium text-foreground">{user.name}</p>
              <p className="text-sm text-muted-foreground">{user.email}</p>
            </div>
          </div>
          <div>
            <Label>Rol</Label>
            <div className="mt-1">
              <Badge label={roleLabel} variant="neutral" />
            </div>
          </div>
          <div>
            <Label>Fecha de registro</Label>
            <p className="text-sm">{fmtDate(user.createdAt)}</p>
          </div>
        </div>
      )}

      {isFormMode && (
        <div className="space-y-4">
          <Field label="Nombre">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nombre completo"
              autoFocus
              maxLength={200}
            />
          </Field>
          <Field label="Correo">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="correo@ejemplo.com"
              maxLength={200}
            />
          </Field>
          <Field label={mode === "edit" ? "Nueva contraseña (opcional)" : "Contraseña"}>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "edit" ? "Dejar vacío para no cambiar" : "Mínimo 8 caracteres"}
              required={mode === "create"}
              minLength={mode === "create" ? 8 : undefined}
            />
          </Field>
          <Field label="Rol">
            <Select value={role} onChange={(e) => setRole(e.target.value)}>
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      )}

      {isDeleteMode && user && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            ¿Estás seguro de que deseas eliminar al usuario{" "}
            <span className="font-semibold text-foreground">{user.name}</span>?
          </p>
          {isSelfDelete && (
            <div className="rounded-lg border border-danger/20 bg-danger-soft px-3 py-2 text-sm text-danger">
              No puedes eliminar tu propia cuenta.
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

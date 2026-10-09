"use client";

import { useState, useEffect } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label, Field } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { StatusBadge } from "@/components/ui/badge";
import { fmtDateTime } from "@/lib/format";

type CategoriaModalMode = "create" | "edit" | "view" | "delete";

interface Categoria {
  id: string;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  creado_en: string;
  actualizado_en: string;
  productos_count?: number;
}

interface CategoriaModalProps {
  open: boolean;
  mode: CategoriaModalMode;
  categoria: Categoria | null;
  onClose: () => void;
  onSuccess: (message: string) => void;
}

export function CategoriaModal({ open, mode, categoria, onClose, onSuccess }: CategoriaModalProps) {
  const [nombre, setNombre] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [activo, setActivo] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (categoria && (mode === "edit" || mode === "view")) {
      setNombre(categoria.nombre);
      setDescripcion(categoria.descripcion || "");
      setActivo(categoria.activo);
    } else if (mode === "create") {
      setNombre("");
      setDescripcion("");
      setActivo(true);
    }
    setError("");
  }, [categoria, mode, open]);

  const handleSubmit = async () => {
    setLoading(true);
    setError("");

    try {
      if (mode === "create") {
        const res = await fetch("/api/categorias", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nombre, descripcion: descripcion || null, activo }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error al crear categoría");
      } else if (mode === "edit" && categoria) {
        const res = await fetch("/api/categorias", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: categoria.id, nombre, descripcion: descripcion || null, activo }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error al actualizar categoría");
      } else if (mode === "delete" && categoria) {
        const res = await fetch(`/api/categorias?id=${categoria.id}`, {
          method: "DELETE",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error al eliminar categoría");
      }
      const msgs: Record<string, string> = {
        create: `Categoría "${nombre}" creada exitosamente`,
        edit: `Categoría "${nombre}" actualizada exitosamente`,
        delete: `Categoría eliminada exitosamente`,
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

  const titles: Record<CategoriaModalMode, string> = {
    create: "Nueva Categoría",
    edit: "Editar Categoría",
    view: "Detalle de Categoría",
    delete: "Eliminar Categoría",
  };

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
              disabled={loading || (isFormMode && !nombre.trim())}
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

      {mode === "view" && categoria && (
        <div className="space-y-4">
          <div>
            <Label>Nombre</Label>
            <p className="text-sm font-medium">{categoria.nombre}</p>
          </div>
          <div>
            <Label>Descripción</Label>
            <p className="text-sm text-muted-foreground">{categoria.descripcion || "—"}</p>
          </div>
          <div>
            <Label>Estado</Label>
            <div className="mt-1">
              <StatusBadge status={categoria.activo ? "Activo" : "Inactivo"} />
            </div>
          </div>
          <div>
            <Label>Productos asociados</Label>
            <p className="text-sm font-mono font-semibold text-primary">
              {categoria.productos_count ?? 0}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
            <div>
              <Label>Creado</Label>
              <p>{fmtDateTime(categoria.creado_en)}</p>
            </div>
            <div>
              <Label>Actualizado</Label>
              <p>{fmtDateTime(categoria.actualizado_en)}</p>
            </div>
          </div>
        </div>
      )}

      {isFormMode && (
        <div className="space-y-4">
          <Field label="Nombre">
            <Input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej: Lácteos, Bebidas, Limpieza"
              autoFocus
              maxLength={100}
            />
          </Field>
          <Field label="Descripción">
            <textarea
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Ej: Leche pasteurizada entera 1L"
              rows={3}
              maxLength={500}
            />
          </Field>
          <div className="flex items-center justify-between">
            <Label>Activo</Label>
            <Switch defaultChecked={activo} onCheckedChange={setActivo} />
          </div>
        </div>
      )}

      {isDeleteMode && categoria && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            ¿Estás seguro de que deseas eliminar la categoría{" "}
            <span className="font-semibold text-foreground">{categoria.nombre}</span>?
          </p>
          {categoria.productos_count && categoria.productos_count > 0 && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm text-amber-600">
              Esta categoría tiene <strong>{categoria.productos_count}</strong> producto(s) asociado(s).
              Debes reasignarlos antes de eliminarla.
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

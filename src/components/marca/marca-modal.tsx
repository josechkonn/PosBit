"use client";

import { useState, useEffect } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label, Field } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { StatusBadge } from "@/components/ui/badge";
import { fmtDateTime } from "@/lib/format";

type MarcaModalMode = "create" | "edit" | "view" | "delete";

interface Marca {
  id: string;
  nombre: string;
  pais: string | null;
  activo: boolean;
  creado_en: string;
  actualizado_en: string;
  productos_count?: number;
}

interface MarcaModalProps {
  open: boolean;
  mode: MarcaModalMode;
  marca: Marca | null;
  onClose: () => void;
  onSuccess: (message: string) => void;
}

export function MarcaModal({ open, mode, marca, onClose, onSuccess }: MarcaModalProps) {
  const [nombre, setNombre] = useState("");
  const [pais, setPais] = useState("");
  const [activo, setActivo] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (marca && (mode === "edit" || mode === "view")) {
      setNombre(marca.nombre);
      setPais(marca.pais || "");
      setActivo(marca.activo);
    } else if (mode === "create") {
      setNombre("");
      setPais("");
      setActivo(true);
    }
    setError("");
  }, [marca, mode, open]);

  const handleSubmit = async () => {
    setLoading(true);
    setError("");

    try {
      if (mode === "create") {
        const res = await fetch("/api/marcas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nombre, pais: pais || null, activo }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error al crear marca");
      } else if (mode === "edit" && marca) {
        const res = await fetch("/api/marcas", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: marca.id, nombre, pais: pais || null, activo }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error al actualizar marca");
      } else if (mode === "delete" && marca) {
        const res = await fetch(`/api/marcas?id=${marca.id}`, {
          method: "DELETE",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error al eliminar marca");
      }
      const msgs: Record<string, string> = {
        create: `Marca "${nombre}" creada exitosamente`,
        edit: `Marca "${nombre}" actualizada exitosamente`,
        delete: `Marca eliminada exitosamente`,
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

  const titles: Record<MarcaModalMode, string> = {
    create: "Nueva Marca",
    edit: "Editar Marca",
    view: "Detalle de Marca",
    delete: "Eliminar Marca",
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

      {mode === "view" && marca && (
        <div className="space-y-4">
          <div>
            <Label>Nombre</Label>
            <p className="text-sm font-medium">{marca.nombre}</p>
          </div>
          <div>
            <Label>País de Origen</Label>
            <p className="text-sm text-muted-foreground">{marca.pais || "—"}</p>
          </div>
          <div>
            <Label>Estado</Label>
            <div className="mt-1">
              <StatusBadge status={marca.activo ? "Activo" : "Inactivo"} />
            </div>
          </div>
          <div>
            <Label>Productos asociados</Label>
            <p className="text-sm font-mono font-semibold text-primary">
              {marca.productos_count ?? 0}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
            <div>
              <Label>Creado</Label>
              <p>{fmtDateTime(marca.creado_en)}</p>
            </div>
            <div>
              <Label>Actualizado</Label>
              <p>{fmtDateTime(marca.actualizado_en)}</p>
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
              placeholder="Ej: Polar, PAN, Coca-Cola"
              autoFocus
              maxLength={100}
            />
          </Field>
          <Field label="País de Origen">
            <Input
              value={pais}
              onChange={(e) => setPais(e.target.value)}
              placeholder="Ej: Venezuela, México, Colombia"
              maxLength={100}
            />
          </Field>
          <div className="flex items-center justify-between">
            <Label>Activo</Label>
            <Switch defaultChecked={activo} onCheckedChange={setActivo} />
          </div>
        </div>
      )}

      {isDeleteMode && marca && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            ¿Estás seguro de que deseas eliminar la marca{" "}
            <span className="font-semibold text-foreground">{marca.nombre}</span>?
          </p>
          {marca.productos_count && marca.productos_count > 0 && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm text-amber-600">
              Esta marca tiene <strong>{marca.productos_count}</strong> producto(s) asociado(s).
              Debes reasignarlos antes de eliminarla.
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

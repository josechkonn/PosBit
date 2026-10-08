"use client";

import { useState, useEffect } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label, Field } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { StatusBadge } from "@/components/ui/badge";
import { fmtDateTime } from "@/lib/format";

type ProveedorModalMode = "create" | "edit" | "view" | "delete";

interface Proveedor {
  id: number;
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

interface ProveedorModalProps {
  open: boolean;
  mode: ProveedorModalMode;
  proveedor: Proveedor | null;
  onClose: () => void;
  onSuccess: (message: string) => void;
}

export function ProveedorModal({ open, mode, proveedor, onClose, onSuccess }: ProveedorModalProps) {
  const [nombre, setNombre] = useState("");
  const [contacto, setContacto] = useState("");
  const [email, setEmail] = useState("");
  const [telefono, setTelefono] = useState("");
  const [ciudad, setCiudad] = useState("");
  const [direccion, setDireccion] = useState("");
  const [rif, setRif] = useState("");
  const [activo, setActivo] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (proveedor && (mode === "edit" || mode === "view")) {
      setNombre(proveedor.nombre);
      setContacto(proveedor.contacto || "");
      setEmail(proveedor.email || "");
      setTelefono(proveedor.telefono || "");
      setCiudad(proveedor.ciudad || "");
      setDireccion(proveedor.direccion || "");
      setRif(proveedor.rif || "");
      setActivo(proveedor.activo);
    } else if (mode === "create") {
      setNombre("");
      setContacto("");
      setEmail("");
      setTelefono("");
      setCiudad("");
      setDireccion("");
      setRif("");
      setActivo(true);
    }
    setError("");
  }, [proveedor, mode, open]);

  const handleSubmit = async () => {
    setLoading(true);
    setError("");

    try {
      if (mode === "create") {
        const res = await fetch("/api/proveedores", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nombre,
            contacto: contacto || null,
            email: email || null,
            telefono: telefono || null,
            ciudad: ciudad || null,
            direccion: direccion || null,
            rif: rif || null,
            activo,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error al crear proveedor");
      } else if (mode === "edit" && proveedor) {
        const res = await fetch("/api/proveedores", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: proveedor.id,
            nombre,
            contacto: contacto || null,
            email: email || null,
            telefono: telefono || null,
            ciudad: ciudad || null,
            direccion: direccion || null,
            rif: rif || null,
            activo,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error al actualizar proveedor");
      } else if (mode === "delete" && proveedor) {
        const res = await fetch(`/api/proveedores?id=${proveedor.id}`, {
          method: "DELETE",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error al eliminar proveedor");
      }
      const msgs: Record<string, string> = {
        create: `Proveedor "${nombre}" creado exitosamente`,
        edit: `Proveedor "${nombre}" actualizado exitosamente`,
        delete: `Proveedor eliminado exitosamente`,
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

  const titles: Record<ProveedorModalMode, string> = {
    create: "Nuevo Proveedor",
    edit: "Editar Proveedor",
    view: "Detalle de Proveedor",
    delete: "Eliminar Proveedor",
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={titles[mode]}
      className="max-w-xl w-[90vw]"
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

      {mode === "view" && proveedor && (
        <div className="space-y-4">
          <div>
            <Label>Empresa</Label>
            <p className="text-sm font-medium">{proveedor.nombre}</p>
          </div>
          <div>
            <Label>Contacto</Label>
            <p className="text-sm text-muted-foreground">{proveedor.contacto || "—"}</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Correo</Label>
              <p className="text-sm text-primary">{proveedor.email || "—"}</p>
            </div>
            <div>
              <Label>Teléfono</Label>
              <p className="text-sm font-mono">{proveedor.telefono || "—"}</p>
            </div>
          </div>
          <div>
            <Label>Ciudad</Label>
            <p className="text-sm">{proveedor.ciudad || "—"}</p>
          </div>
          <div>
            <Label>Dirección</Label>
            <p className="text-sm text-muted-foreground">{proveedor.direccion || "—"}</p>
          </div>
          <div>
            <Label>RIF</Label>
            <p className="text-sm font-mono">{proveedor.rif || "—"}</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Estado</Label>
              <div className="mt-1">
                <StatusBadge status={proveedor.activo ? "Activo" : "Inactivo"} />
              </div>
            </div>
            <div>
              <Label>Compras asociadas</Label>
              <p className="text-sm font-mono font-semibold text-primary">
                {proveedor.compras_count ?? 0}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
            <div>
              <Label>Creado</Label>
              <p>{fmtDateTime(proveedor.creado_en)}</p>
            </div>
            <div>
              <Label>Actualizado</Label>
              <p>{fmtDateTime(proveedor.actualizado_en)}</p>
            </div>
          </div>
        </div>
      )}

      {isFormMode && (
        <div className="space-y-4">
          <Field label="Empresa">
            <Input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej: Distribuidora Polar C.A."
              autoFocus
              maxLength={200}
            />
          </Field>
          <Field label="Persona de Contacto">
            <Input
              value={contacto}
              onChange={(e) => setContacto(e.target.value)}
              placeholder="Nombre del contacto"
              maxLength={200}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Correo">
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="contacto@distribuidora.com"
                type="email"
                maxLength={200}
              />
            </Field>
            <Field label="Teléfono">
              <Input
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                placeholder="+591 77712345"
                maxLength={50}
              />
            </Field>
          </div>
          <Field label="Ciudad">
            <Input
              value={ciudad}
              onChange={(e) => setCiudad(e.target.value)}
              placeholder="Ej: La Paz"
              maxLength={100}
            />
          </Field>
          <Field label="Dirección">
            <textarea
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              value={direccion}
              onChange={(e) => setDireccion(e.target.value)}
              placeholder="Dirección completa..."
              rows={2}
              maxLength={500}
            />
          </Field>
          <Field label="RIF">
            <Input
              value={rif}
              onChange={(e) => setRif(e.target.value)}
              placeholder="Registro de Información Fiscal"
              maxLength={50}
            />
          </Field>
          <div className="flex items-center justify-between">
            <Label>Activo</Label>
            <Switch defaultChecked={activo} onCheckedChange={setActivo} />
          </div>
        </div>
      )}

      {isDeleteMode && proveedor && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            ¿Estás seguro de que deseas eliminar el proveedor{" "}
            <span className="font-semibold text-foreground">{proveedor.nombre}</span>?
          </p>
          {proveedor.compras_count && proveedor.compras_count > 0 && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm text-amber-600">
              Este proveedor tiene <strong>{proveedor.compras_count}</strong> compra(s) asociada(s).
              Debes reasignarlas antes de eliminarlo.
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

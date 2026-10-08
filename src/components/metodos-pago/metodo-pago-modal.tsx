"use client";

import { useState, useEffect } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label, Field } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/badge";
import { fmtDateTime } from "@/lib/format";

const TIPOS_PAGO = ["Efectivo", "Electronico", "Tarjeta"];

type MetodoModalMode = "create" | "edit" | "view" | "delete";

interface Caja {
  id: number;
  nombre: string;
  moneda_codigo: string;
  moneda_simbolo: string;
}

interface MetodoPago {
  id: number;
  nombre: string;
  tipo: string;
  caja_id: number | null;
  activo: boolean;
  creado_en: string;
  actualizado_en: string;
  caja_nombre?: string;
  moneda_codigo?: string;
  moneda_simbolo?: string;
}

interface MetodoPagoModalProps {
  open: boolean;
  mode: MetodoModalMode;
  metodo: MetodoPago | null;
  cajas: Caja[];
  onClose: () => void;
  onSuccess: (message: string) => void;
}

export function MetodoPagoModal({ open, mode, metodo, cajas, onClose, onSuccess }: MetodoPagoModalProps) {
  const [nombre, setNombre] = useState("");
  const [tipo, setTipo] = useState("");
  const [cajaId, setCajaId] = useState<number | null>(null);
  const [activo, setActivo] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (metodo && (mode === "edit" || mode === "view")) {
      setNombre(metodo.nombre);
      setTipo(metodo.tipo);
      setCajaId(metodo.caja_id);
      setActivo(metodo.activo);
    } else if (mode === "create") {
      setNombre("");
      setTipo("");
      setCajaId(null);
      setActivo(true);
    }
    setError("");
  }, [metodo, mode, open]);

  const handleSubmit = async () => {
    setLoading(true);
    setError("");

    try {
      if (mode === "create") {
        const res = await fetch("/api/metodos-pago", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nombre, tipo, caja_id: cajaId, activo }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error al crear método de pago");
      } else if (mode === "edit" && metodo) {
        const res = await fetch("/api/metodos-pago", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: metodo.id, nombre, tipo, caja_id: cajaId, activo }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error al actualizar método de pago");
      } else if (mode === "delete" && metodo) {
        const res = await fetch(`/api/metodos-pago?id=${metodo.id}`, {
          method: "DELETE",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error al eliminar método de pago");
      }
      const msgs: Record<string, string> = {
        create: `Método de pago "${nombre}" creado exitosamente`,
        edit: `Método de pago "${nombre}" actualizado exitosamente`,
        delete: `Método de pago eliminado exitosamente`,
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

  const titles: Record<MetodoModalMode, string> = {
    create: "Nuevo Método de Pago",
    edit: "Editar Método de Pago",
    view: "Detalle del Método de Pago",
    delete: "Eliminar Método de Pago",
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
              disabled={loading || (isFormMode && (!nombre.trim() || !tipo))}
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

      {mode === "view" && metodo && (
        <div className="space-y-4">
          <div>
            <Label>Nombre</Label>
            <p className="text-sm font-medium">{metodo.nombre}</p>
          </div>
          <div>
            <Label>Tipo</Label>
            <p className="text-sm">{metodo.tipo}</p>
          </div>
          <div>
            <Label>Caja</Label>
            <p className="text-sm">
              {metodo.caja_nombre || "—"}
              {metodo.moneda_codigo && (
                <span className="ml-1 text-muted-foreground">({metodo.moneda_simbolo} {metodo.moneda_codigo})</span>
              )}
            </p>
          </div>
          <div>
            <Label>Estado</Label>
            <div className="mt-1">
              <StatusBadge status={metodo.activo ? "Activo" : "Inactivo"} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
            <div>
              <Label>Creado</Label>
              <p>{fmtDateTime(metodo.creado_en)}</p>
            </div>
            <div>
              <Label>Actualizado</Label>
              <p>{fmtDateTime(metodo.actualizado_en)}</p>
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
              placeholder="Ej: Efectivo USD"
              autoFocus
              maxLength={100}
            />
          </Field>
          <Field label="Tipo">
            <Select value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="">Seleccionar tipo...</option>
              {TIPOS_PAGO.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Caja">
            <Select
              value={cajaId?.toString() || ""}
              onChange={(e) => setCajaId(e.target.value ? parseInt(e.target.value) : null)}
            >
              <option value="">Sin caja asignada</option>
              {cajas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre} ({c.moneda_simbolo} {c.moneda_codigo})
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-center justify-between">
            <Label>Activo</Label>
            <Switch defaultChecked={activo} onCheckedChange={setActivo} />
          </div>
        </div>
      )}

      {isDeleteMode && metodo && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            ¿Estás seguro de que deseas eliminar el método de pago{" "}
            <span className="font-semibold text-foreground">{metodo.nombre}</span>?
          </p>
        </div>
      )}
    </Modal>
  );
}

"use client";

import { useState, useEffect } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label, Field } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { StatusBadge } from "@/components/ui/badge";
import { fmt, fmtDateTime } from "@/lib/format";

type ClienteModalMode = "create" | "edit" | "view" | "delete";

interface PorCobrarItem {
  codigo: string;
  simbolo: string;
  monto: number;
}

interface LimiteCredito {
  moneda_id: number;
  codigo: string;
  simbolo?: string;
  es_base?: boolean;
  limite: number | string;
}

interface Cliente {
  id: number;
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
  limites_credito?: LimiteCredito[];
  ventas_count?: number;
  retornos_count?: number;
}

interface ClienteModalProps {
  open: boolean;
  mode: ClienteModalMode;
  cliente: Cliente | null;
  onClose: () => void;
  onSuccess: (message: string, data?: any) => void;
}

export function ClienteModal({ open, mode, cliente, onClose, onSuccess }: ClienteModalProps) {
  const [nombre, setNombre] = useState("");
  const [tipo, setTipo] = useState("Persona Natural");
  const [documento, setDocumento] = useState("");
  const [email, setEmail] = useState("");
  const [telefono, setTelefono] = useState("");
  const [ciudad, setCiudad] = useState("");
  const [direccion, setDireccion] = useState("");
  const [recibeCredito, setRecibeCredito] = useState(false);
  const [limites, setLimites] = useState<{ moneda_id: number; limite: string }[]>([]);
  const [monedas, setMonedas] = useState<{ id: number; codigo: string }[]>([]);
  const [activo, setActivo] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Monedas activas: una casilla de límite por cada una
  useEffect(() => {
    if (!open) return;
    fetch("/api/monedas")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setMonedas(Array.isArray(data) ? data.filter((m: any) => m.activo !== false) : []))
      .catch(() => setMonedas([]));
  }, [open]);

  useEffect(() => {
    if (!open || monedas.length === 0) return;
    const guardados = new Map<number, string>();
    (cliente?.limites_credito || []).forEach((l) => guardados.set(l.moneda_id, String(l.limite ?? "0")));

    setLimites(
      monedas.map((m) => ({
        moneda_id: m.id,
        limite: guardados.get(m.id) ?? "0",
      }))
    );
  }, [open, monedas, cliente, mode]);

  useEffect(() => {
    if (cliente && (mode === "edit" || mode === "view")) {
      setNombre(cliente.nombre);
      setTipo(cliente.tipo || "Persona Natural");
      setDocumento(cliente.documento || "");
      setEmail(cliente.email || "");
      setTelefono(cliente.telefono || "");
      setCiudad(cliente.ciudad || "");
      setDireccion(cliente.direccion || "");
      setRecibeCredito(cliente.recibe_credito);
      setActivo(cliente.activo);
    } else if (mode === "create") {
      setNombre("");
      setTipo("Persona Natural");
      setDocumento("");
      setEmail("");
      setTelefono("");
      setCiudad("");
      setDireccion("");
      setRecibeCredito(false);
      setActivo(true);
    }
    setError("");
  }, [cliente, mode, open]);

  const handleSubmit = async () => {
    setLoading(true);
    setError("");
    let finalData: any = null;

    try {
      const payload = {
        nombre,
        tipo,
        documento: documento || null,
        email: email || null,
        telefono: telefono || null,
        ciudad: ciudad || null,
        direccion: direccion || null,
        recibe_credito: recibeCredito,
        limites_credito: limites.map((l) => ({
          moneda_id: l.moneda_id,
          limite: parseFloat(l.limite) || 0,
        })),
        activo,
      };

      if (mode === "create") {
        const res = await fetch("/api/clientes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error al crear cliente");
        finalData = data;
      } else if (mode === "edit" && cliente) {
        const res = await fetch("/api/clientes", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: cliente.id, ...payload }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error al actualizar cliente");
        finalData = data;
      } else if (mode === "delete" && cliente) {
        const res = await fetch(`/api/clientes?id=${cliente.id}`, {
          method: "DELETE",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error al eliminar cliente");
        finalData = null;
      }
      const msgs: Record<string, string> = {
        create: `Cliente "${nombre}" creado exitosamente`,
        edit: `Cliente "${nombre}" actualizado exitosamente`,
        delete: `Cliente eliminado exitosamente`,
      };
      onSuccess(msgs[mode] || "Operación exitosa", finalData);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  };

  const isFormMode = mode === "create" || mode === "edit";
  const isDeleteMode = mode === "delete";
  const deudaItems: PorCobrarItem[] = Array.isArray(cliente?.deuda_total)
    ? cliente.deuda_total.filter((d) => Number(d.monto) > 0)
    : [];

  const titles: Record<ClienteModalMode, string> = {
    create: "Nuevo Cliente",
    edit: "Editar Cliente",
    view: "Detalle de Cliente",
    delete: "Eliminar Cliente",
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

      {mode === "view" && cliente && (
        <div className="space-y-4">
          <div>
            <Label>Nombre</Label>
            <p className="text-sm font-medium">{cliente.nombre}</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Tipo</Label>
              <div className="mt-1">
                <StatusBadge status={cliente.tipo || "Persona Natural"} />
              </div>
            </div>
            <div>
              <Label>Documento</Label>
              <p className="text-sm font-mono">{cliente.documento || "—"}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Correo</Label>
              <p className="text-sm text-primary">{cliente.email || "—"}</p>
            </div>
            <div>
              <Label>Teléfono</Label>
              <p className="text-sm font-mono">{cliente.telefono || "—"}</p>
            </div>
          </div>
          <div>
            <Label>Ciudad</Label>
            <p className="text-sm">{cliente.ciudad || "—"}</p>
          </div>
          <div>
            <Label>Dirección</Label>
            <p className="text-sm text-muted-foreground">{cliente.direccion || "—"}</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Crédito</Label>
              <p className="text-sm font-medium">{cliente.recibe_credito ? "Habilitado" : "No habilitado"}</p>
            </div>
            <div>
              <Label>Límite de crédito</Label>
              <div className="flex flex-col gap-0.5">
                {(cliente.limites_credito || []).map((l) => (
                  <p key={l.moneda_id} className="text-sm font-mono">
                    {fmt(l.limite ?? 0, l.codigo)}
                    {parseFloat(String(l.limite ?? 0)) <= 0 && (
                      <span className="ml-1 font-sans text-xs text-muted-foreground">(sin crédito)</span>
                    )}
                  </p>
                ))}
                {(cliente.limites_credito || []).length === 0 && (
                  <p className="text-sm font-mono">{fmt(0, "USD")}</p>
                )}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>Deuda actual</Label>
              {deudaItems.length > 0 ? (
                <div className="flex flex-col gap-0.5">
                  {deudaItems.map((d) => (
                    <p key={d.codigo} className="text-sm font-mono font-semibold text-danger">
                      {fmt(d.monto, d.codigo)}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="text-sm font-mono font-semibold text-success-strong">{fmt(0, "USD")}</p>
              )}
            </div>
            <div>
              <Label>Ventas</Label>
              <p className="text-sm font-mono font-semibold text-primary">{cliente.ventas_count ?? 0}</p>
            </div>
            <div>
              <Label>Retornos</Label>
              <p className="text-sm font-mono font-semibold">{cliente.retornos_count ?? 0}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Estado</Label>
              <div className="mt-1">
                <StatusBadge status={cliente.activo ? "Activo" : "Inactivo"} />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
            <div>
              <Label>Creado</Label>
              <p>{fmtDateTime(cliente.creado_en)}</p>
            </div>
            <div>
              <Label>Actualizado</Label>
              <p>{fmtDateTime(cliente.actualizado_en)}</p>
            </div>
          </div>
        </div>
      )}

      {isFormMode && (
        <div className="space-y-4">
          <Field label="Nombre *">
            <Input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej: María González"
              autoFocus
              maxLength={200}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tipo">
              <Select value={tipo} onChange={(e) => setTipo(e.target.value)}>
                <option value="Persona Natural">Persona Natural</option>
                <option value="Empresa">Empresa</option>
              </Select>
            </Field>
            <Field label="Documento (CI/RIF)">
              <Input
                value={documento}
                onChange={(e) => setDocumento(e.target.value)}
                placeholder="CI o RIF"
                maxLength={50}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Correo">
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="cliente@correo.com"
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

          <div className="space-y-2">
            <Label>Límite de crédito por moneda</Label>
            <div className={`grid gap-2 ${limites.length > 2 ? "grid-cols-3" : "grid-cols-2"}`}>
              {limites.map((l, i) => {
                const moneda = monedas.find((m) => m.id === l.moneda_id);
                return (
                  <div key={l.moneda_id}>
                    <span className="mb-1 block text-xs text-muted-foreground">
                      {moneda?.codigo}
                    </span>
                    <Input
                      value={l.limite}
                      onChange={(e) =>
                        setLimites((prev) =>
                          prev.map((x, idx) => (idx === i ? { ...x, limite: e.target.value } : x))
                        )
                      }
                      placeholder="0"
                      type="number"
                      min={0}
                      step="0.01"
                      disabled={!recibeCredito}
                    />
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              0 = el cliente no puede recibir crédito en esa moneda.
            </p>
          </div>
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
          <div className="flex items-center justify-between">
            <Label>Recibe crédito</Label>
            <Switch defaultChecked={recibeCredito} onCheckedChange={setRecibeCredito} />
          </div>
          <div className="flex items-center justify-between">
            <Label>Activo</Label>
            <Switch defaultChecked={activo} onCheckedChange={setActivo} />
          </div>
        </div>
      )}

      {isDeleteMode && cliente && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            ¿Estás seguro de que deseas eliminar el cliente{" "}
            <span className="font-semibold text-foreground">{cliente.nombre}</span>?
          </p>
          {deudaItems.length > 0 && (
            <div className="rounded-lg border border-danger/20 bg-danger-soft px-3 py-2 text-sm text-danger">
              Este cliente tiene una deuda pendiente de{" "}
              {deudaItems.map((d) => (
                <strong key={d.codigo}>{fmt(d.monto, d.codigo)}</strong>
              ))}
              . Verifica antes de eliminar.
            </div>
          )}
          {cliente.ventas_count && cliente.ventas_count > 0 && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm text-amber-600">
              Este cliente tiene <strong>{cliente.ventas_count}</strong> venta(s) asociada(s).
              Debes reasignarlas antes de eliminarlo.
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

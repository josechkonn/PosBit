"use client";

import { useState, useEffect } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label, Field } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { fmtDateTime } from "@/lib/format";

type MonedaModalMode = "create" | "edit" | "view" | "delete";

interface Moneda {
  id: string;
  nombre: string;
  codigo: string;
  simbolo: string;
  tasa: number | string;
  tasa_ref_moneda_id?: string | null;
  decimales: number;
  es_base: boolean;
  activo: boolean;
  usa_tasa_usd_directa?: boolean;
  tasa_usd_directa?: number | string | null;
  creado_en: string;
  actualizado_en: string;
  cajas_count?: number;
}

interface MonedaModalProps {
  open: boolean;
  mode: MonedaModalMode;
  moneda: Moneda | null;
  onClose: () => void;
  onSuccess: (message: string) => void;
}

export function MonedaModal({ open, mode, moneda, onClose, onSuccess }: MonedaModalProps) {
  const [nombre, setNombre] = useState("");
  const [codigo, setCodigo] = useState("");
  const [simbolo, setSimbolo] = useState("");
  const [tasa, setTasa] = useState("1.000000");
  const [tasaRefId, setTasaRefId] = useState<string>("");
  const [usaDirecta, setUsaDirecta] = useState(false);
  const [tasaUsdDirecta, setTasaUsdDirecta] = useState("");
  const [monedasCatalogo, setMonedasCatalogo] = useState<Moneda[]>([]);
  const [decimales, setDecimales] = useState("2");
  const [esBase, setEsBase] = useState(false);
  const [activo, setActivo] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Catálogo para elegir la moneda de referencia de la tasa
  useEffect(() => {
    if (!open) return;
    fetch("/api/monedas")
      .then((r) => r.json())
      .then((data) => setMonedasCatalogo(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    if (moneda && (mode === "edit" || mode === "view")) {
      setNombre(moneda.nombre);
      setCodigo(moneda.codigo);
      setSimbolo(moneda.simbolo);
      setTasa(String(parseFloat(String(moneda.tasa)).toFixed(6)));
      setTasaRefId(moneda.tasa_ref_moneda_id ? String(moneda.tasa_ref_moneda_id) : "");
      setUsaDirecta(moneda.usa_tasa_usd_directa === true);
      setTasaUsdDirecta(
        moneda.tasa_usd_directa !== null && moneda.tasa_usd_directa !== undefined
          ? String(parseFloat(String(moneda.tasa_usd_directa)))
          : ""
      );
      setDecimales(String(moneda.decimales ?? 2));
      setEsBase(moneda.es_base);
      setActivo(moneda.activo);
    } else if (mode === "create") {
      setNombre("");
      setCodigo("");
      setSimbolo("");
      setTasa("1.000000");
      setTasaRefId("");
      setUsaDirecta(false);
      setTasaUsdDirecta("");
      setDecimales("2");
      setEsBase(false);
      setActivo(true);
    }
    setError("");
  }, [moneda, mode, open]);

  const handleSubmit = async () => {
    setLoading(true);
    setError("");

    try {
      if (mode === "create") {
        const res = await fetch("/api/monedas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nombre,
            codigo,
            simbolo,
            tasa: esBase ? 1 : parseFloat(tasa),
            // NULL = la tasa es contra la moneda base (USD)
            tasa_ref_moneda_id: esBase ? null : tasaRefId || null,
            decimales: parseInt(decimales) || 2,
            es_base: esBase,
            activo,
            usa_tasa_usd_directa: !esBase && usaDirecta,
            tasa_usd_directa: !esBase && usaDirecta ? parseFloat(tasaUsdDirecta) || null : null,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error al crear moneda");
      } else if (mode === "edit" && moneda) {
        const res = await fetch("/api/monedas", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: moneda.id,
            nombre,
            codigo,
            simbolo,
            tasa: esBase ? 1 : parseFloat(tasa),
            // NULL = la tasa es contra la moneda base (USD); el PUT distingue
            // "no vino" de "vino null", así que siempre se envía
            tasa_ref_moneda_id: esBase ? null : tasaRefId || null,
            decimales: parseInt(decimales) || 2,
            es_base: esBase,
            activo,
            usa_tasa_usd_directa: !esBase && usaDirecta,
            tasa_usd_directa: !esBase && usaDirecta ? parseFloat(tasaUsdDirecta) || null : null,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error al actualizar moneda");
      } else if (mode === "delete" && moneda) {
        const res = await fetch(`/api/monedas?id=${moneda.id}`, {
          method: "DELETE",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error al eliminar moneda");
      }
      const msgs: Record<string, string> = {
        create: `Moneda "${codigo}" creada exitosamente`,
        edit: `Moneda "${codigo}" actualizada exitosamente`,
        delete: `Moneda eliminada exitosamente`,
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

  const titles: Record<MonedaModalMode, string> = {
    create: "Nueva Moneda",
    edit: "Editar Moneda",
    view: "Detalle de Moneda",
    delete: "Eliminar Moneda",
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
              disabled={loading || (isFormMode && (!nombre.trim() || !codigo.trim() || !simbolo.trim()))}
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

      {mode === "view" && moneda && (
        <div className="space-y-4">
          <div>
            <Label>Nombre</Label>
            <p className="text-sm font-medium">{moneda.nombre}</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Código</Label>
              <p className="text-sm font-mono font-bold">{moneda.codigo}</p>
            </div>
            <div>
              <Label>Símbolo</Label>
              <p className="text-sm font-mono font-bold">{moneda.simbolo}</p>
            </div>
          </div>
          <div>
            <Label>Tasa de Cambio</Label>
            <p className="text-sm font-mono">{parseFloat(String(moneda.tasa)).toFixed(6)}</p>
            <p className="text-xs text-muted-foreground">
              Referencia:{" "}
              {moneda.tasa_ref_moneda_id
                ? monedasCatalogo.find((m) => m.id === moneda.tasa_ref_moneda_id)?.codigo ||
                  `moneda #${moneda.tasa_ref_moneda_id}`
                : "moneda base (USD)"}
            </p>
          </div>
          {moneda.usa_tasa_usd_directa && moneda.tasa_usd_directa != null && (
            <div className="rounded-lg border border-primary/20 bg-primary-soft/40 px-3 py-2">
              <Label>Conversión directa a USD</Label>
              <p className="text-sm font-mono">
                {parseFloat(String(moneda.tasa_usd_directa)).toFixed(6)}
              </p>
              <p className="text-xs text-muted-foreground">
                El par con USD usa esta tasa; el par con su referencia usa la tasa de arriba.
              </p>
            </div>
          )}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>Decimales</Label>
              <p className="text-sm font-mono">{moneda.decimales ?? 2}</p>
            </div>
            <div>
              <Label>Moneda Base</Label>
              <div className="mt-1">
                {moneda.es_base ? (
                  <Badge label="Base" variant="purple" />
                ) : (
                  <span className="text-xs text-muted-foreground">No</span>
                )}
              </div>
            </div>
            <div>
              <Label>Estado</Label>
              <div className="mt-1">
                <StatusBadge status={moneda.activo ? "Activo" : "Inactivo"} />
              </div>
            </div>
          </div>
          <div>
            <Label>Cajas asociadas</Label>
            <p className="text-sm font-mono font-semibold text-primary">
              {moneda.cajas_count ?? 0}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
            <div>
              <Label>Creado</Label>
              <p>{fmtDateTime(moneda.creado_en)}</p>
            </div>
            <div>
              <Label>Actualizado</Label>
              <p>{fmtDateTime(moneda.actualizado_en)}</p>
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
              placeholder="Ej: Dólar Estadounidense"
              autoFocus
              maxLength={100}
            />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Código">
              <Input
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.toUpperCase())}
                placeholder="USD"
                maxLength={3}
              />
            </Field>
            <Field label="Símbolo">
              <Input
                value={simbolo}
                onChange={(e) => setSimbolo(e.target.value)}
                placeholder="$"
                maxLength={5}
              />
            </Field>
            <Field label="Decimales">
              <Input
                value={decimales}
                onChange={(e) => setDecimales(e.target.value)}
                placeholder="2"
                type="number"
                min="0"
                max="6"
              />
            </Field>
          </div>
          {esBase ? (
            <Field label="Tasa">
              <Input value="1" disabled />
              <p className="mt-1 text-[11px] leading-tight text-muted-foreground">
                La moneda base siempre tiene tasa 1; las demás se miden contra ella.
              </p>
            </Field>
          ) : (
            <>
              <Field label="La tasa equivale a (referencia)">
                <div className="flex items-center gap-2">
                  <Input
                    value={tasa}
                    onChange={(e) => setTasa(e.target.value)}
                    placeholder="1.000000"
                    type="number"
                    step="0.000001"
                    className="flex-1"
                  />
                  <select
                    value={tasaRefId}
                    onChange={(e) => setTasaRefId(e.target.value)}
                    className="h-10 rounded border border-border bg-background px-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="">USD (base)</option>
                    {monedasCatalogo
                      .filter((m) => m.id !== moneda?.id && m.activo !== false && !m.es_base)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.codigo}
                        </option>
                      ))}
                  </select>
                </div>
                <p className="mt-1 text-[11px] leading-tight text-muted-foreground">
                  Ej.: 3.2 con referencia BS significa 3.2 COP por 1 BS.
                </p>
              </Field>

              <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <Label>Conversión directa a USD</Label>
                    <p className="text-[11px] leading-tight text-muted-foreground">
                      Usa una tasa propia para USD en vez de derivarla de la referencia.
                    </p>
                  </div>
                  <Switch checked={usaDirecta} onCheckedChange={setUsaDirecta} />
                </div>
                {usaDirecta && (
                  <Field label="Tasa directa a USD (unidades por 1 USD)">
                    <Input
                      value={tasaUsdDirecta}
                      onChange={(e) => setTasaUsdDirecta(e.target.value)}
                      placeholder="Ej: 3200"
                      type="number"
                      step="0.000001"
                      min="0"
                    />
                    <p className="mt-1 text-[11px] leading-tight text-muted-foreground">
                      Se usa para el par con USD. El par con la referencia ({tasaRefId
                        ? monedasCatalogo.find((m) => m.id === tasaRefId)?.codigo || "referencia"
                        : "USD"}) sigue usando la tasa de arriba.
                    </p>
                  </Field>
                )}
              </div>
            </>
          )}
          <div className="flex items-center justify-between">
            <Label>Moneda Principal</Label>
            <Switch defaultChecked={esBase} onCheckedChange={setEsBase} />
          </div>
          <div className="flex items-center justify-between">
            <Label>Activo</Label>
            <Switch defaultChecked={activo} onCheckedChange={setActivo} />
          </div>
        </div>
      )}

      {isDeleteMode && moneda && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            ¿Estás seguro de que deseas eliminar la moneda{" "}
            <span className="font-semibold text-foreground">{moneda.nombre}</span> ({moneda.codigo})?
          </p>
          {moneda.es_base && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm text-amber-600">
              No se puede eliminar la moneda base del sistema.
            </div>
          )}
          {moneda.cajas_count && moneda.cajas_count > 0 && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm text-amber-600">
              Esta moneda tiene <strong>{moneda.cajas_count}</strong> caja(s) asociada(s).
              Debes eliminarlas antes de eliminar la moneda.
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

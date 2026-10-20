"use client";

import { useState, useEffect } from "react";
import { AlertTriangle, Check, Database, Download, Loader2, Lock, RefreshCw, Save, SlidersHorizontal, Upload } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { CloudSyncCard } from "@/components/configuracion/cloud-sync-card";
import { userInitials, cn } from "@/lib/utils";

interface ConfigItem {
  clave: string;
  valor: string;
  tipo: string;
  descripcion: string;
}

interface GlobalCfg {
  metodo_conversion_compras: string;
  metodo_conversion_ventas: string;
  moneda_transito_compras_id: string | null;
  moneda_transito_ventas_id: string | null;
  auto_precio_compra: boolean;
  redondeo_activo: boolean;
  redondeo_multiplo: number;
  redondeo_no_bajar_de_costo: boolean;
}

interface MonedaOpcion {
  id: string;
  codigo: string;
  nombre: string | null;
  es_base: boolean;
}

export default function ConfiguracionPage() {
  const [config, setConfig] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [hasChanges, setHasChanges] = useState(false);
  const [userData, setUserData] = useState<{ name: string; email: string; role: string } | null>(null);
  const [globalCfg, setGlobalCfg] = useState<GlobalCfg | null>(null);
  const [monedas, setMonedas] = useState<MonedaOpcion[]>([]);
  const [recalculando, setRecalculando] = useState(false);
  const [recalcResult, setRecalcResult] = useState("");
  const [exportando, setExportando] = useState(false);
  const [importando, setImportando] = useState(false);
  const [backupMsg, setBackupMsg] = useState<{ tipo: "success" | "error"; texto: string } | null>(null);
  const [pendingFile, setPendingFile] = useState<{ name: string; content: any } | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  const getVal = (clave: string) => config[clave] ?? "";

  const setVal = (clave: string, valor: string) => {
    setConfig((prev) => ({ ...prev, [clave]: valor }));
    setHasChanges(true);
    setSaved(false);
  };

  const setGlobal = (patch: Partial<GlobalCfg>) => {
    setGlobalCfg((prev) => ({ ...(prev as GlobalCfg), ...patch }));
    setHasChanges(true);
    setSaved(false);
  };

  // Triangulación SIN moneda de tránsito cae silenciosamente a Directa. Se
  // avisa y se impide guardar, para que la regla elegida de verdad aplique.
  const faltaTransitoCompras =
    globalCfg?.metodo_conversion_compras === "triangulacion" && !globalCfg?.moneda_transito_compras_id;
  const faltaTransitoVentas =
    globalCfg?.metodo_conversion_ventas === "triangulacion" && !globalCfg?.moneda_transito_ventas_id;
  const triangulacionIncompleta = faltaTransitoCompras || faltaTransitoVentas;

  useEffect(() => {
    const loadData = async () => {
      try {
        const [configRes, meRes, globalRes, monedasRes] = await Promise.all([
          fetch("/api/configuracion"),
          fetch("/api/me"),
          fetch("/api/configuracion-global"),
          fetch("/api/monedas"),
        ]);

        if (configRes.ok) {
          const data: ConfigItem[] = await configRes.json();
          const map: Record<string, string> = {};
          data.forEach((item) => {
            map[item.clave] = item.valor;
          });
          setConfig(map);
        }

        if (globalRes.ok) {
          const g = await globalRes.json();
          setGlobalCfg({
            metodo_conversion_compras: g.metodo_conversion_compras ?? "directa",
            metodo_conversion_ventas: g.metodo_conversion_ventas ?? "directa",
            moneda_transito_compras_id: g.moneda_transito_compras_id ?? null,
            moneda_transito_ventas_id: g.moneda_transito_ventas_id ?? null,
            auto_precio_compra: g.auto_precio_compra === true,
            redondeo_activo: g.redondeo_activo === true,
            redondeo_multiplo: Number(g.redondeo_multiplo) || 0,
            redondeo_no_bajar_de_costo: g.redondeo_no_bajar_de_costo !== false,
          });
        }

        if (monedasRes.ok) {
          const datos = await monedasRes.json();
          if (Array.isArray(datos)) setMonedas(datos);
        }

        if (meRes.ok) {
          const { user } = await meRes.json();
          if (user) {
            setUserData({
              name: user.name,
              email: user.email,
              role: user.role ?? "usuario",
            });
          }
        }
      } catch (err) {
        console.error("Error loading config:", err);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  const handleSave = async () => {
    setError("");
    if (triangulacionIncompleta) {
      setError(
        "Elegiste triangulación pero falta la moneda de tránsito. Selecciónala (o cambia a Directa) para poder guardar."
      );
      return;
    }
    setSaving(true);

    try {
      for (const [clave, valor] of Object.entries(config)) {
        const res = await fetch("/api/configuracion", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clave, valor }),
        });
        if (!res.ok) throw new Error(`No se pudo guardar "${clave}"`);
      }

      // Reglas globales del motor de precios (fila única tipada).
      if (globalCfg) {
        const res = await fetch("/api/configuracion-global", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(globalCfg),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error || "No se pudo guardar el motor de precios");
        }
        const actualizada = await res.json().catch(() => null);
        if (actualizada) {
          setGlobalCfg({
            metodo_conversion_compras: actualizada.metodo_conversion_compras ?? "directa",
            metodo_conversion_ventas: actualizada.metodo_conversion_ventas ?? "directa",
            moneda_transito_compras_id: actualizada.moneda_transito_compras_id ?? null,
            moneda_transito_ventas_id: actualizada.moneda_transito_ventas_id ?? null,
            auto_precio_compra: actualizada.auto_precio_compra === true,
            redondeo_activo: actualizada.redondeo_activo === true,
            redondeo_multiplo: Number(actualizada.redondeo_multiplo) || 0,
            redondeo_no_bajar_de_costo: actualizada.redondeo_no_bajar_de_costo !== false,
          });
        }
      }

      setSaved(true);
      setHasChanges(false);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar la configuración");
    } finally {
      setSaving(false);
    }
  };

  const handleRecalcular = async () => {
    setRecalculando(true);
    setError("");
    setRecalcResult("");
    try {
      const res = await fetch("/api/configuracion-global/recalcular-precios", { method: "POST" });
      if (!res.ok) throw new Error("recalcular");
      const data = await res.json();
      setRecalcResult(`Precios realineados: ${data.total ?? 0} producto(s)`);
    } catch {
      setError("No se pudieron recalcular los precios automáticos");
    } finally {
      setRecalculando(false);
    }
  };

  const handleExportar = async () => {
    setExportando(true);
    setBackupMsg(null);
    try {
      const res = await fetch("/api/configuracion/backup");
      if (!res.ok) throw new Error("Error al generar respaldo");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `posbit-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      setBackupMsg({ tipo: "success", texto: "Copia de seguridad exportada y descargada con éxito." });
    } catch (err: any) {
      setBackupMsg({ tipo: "error", texto: err?.message || "Error al exportar base de datos" });
    } finally {
      setExportando(false);
    }
  };

  const handleSelectFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBackupMsg(null);
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (!parsed || !parsed.tables || typeof parsed.tables !== "object") {
          setBackupMsg({ tipo: "error", texto: "El archivo no contiene un formato de respaldo válido de PosBit." });
          return;
        }
        setPendingFile({ name: file.name, content: parsed });
        setShowConfirmModal(true);
      } catch {
        setBackupMsg({ tipo: "error", texto: "El archivo seleccionado no es un JSON válido." });
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleConfirmarImportacion = async () => {
    if (!pendingFile) return;
    setImportando(true);
    setShowConfirmModal(false);
    setBackupMsg(null);
    try {
      const res = await fetch("/api/configuracion/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pendingFile.content),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Error al restaurar");
      const prodsCount = result.counts?.productos ?? 0;
      setBackupMsg({
        tipo: "success",
        texto: `Base de datos restaurada correctamente (${prodsCount} productos procesados). Recargando datos...`,
      });
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } catch (err: any) {
      setBackupMsg({ tipo: "error", texto: err?.message || "Error al restaurar base de datos" });
    } finally {
      setImportando(false);
      setPendingFile(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 size={24} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  const userRole = userData?.role ?? "usuario";

  if (userRole !== "admin") {
    return (
      <div className="flex flex-col items-center justify-center py-32">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted">
          <Lock size={32} className="text-muted-foreground" />
        </div>
        <h2 className="mt-6 text-xl font-bold text-foreground">Sin acceso</h2>
        <p className="mt-2 max-w-sm text-center text-sm text-muted-foreground">
          No tienes permisos para acceder a la configuracion. Contacta al administrador.
        </p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Configuracion"
        subtitle="Ajustes generales del sistema de inventario"
      />

      {error && (
        <div className="mb-4 rounded-lg border border-danger/20 bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {saved && (
        <div className="mb-4 rounded-lg border border-success/20 bg-success-soft px-4 py-3 text-sm text-success">
          <Check size={14} className="mr-1 inline" />
          Configuracion guardada correctamente
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Datos de la Empresa</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Nombre de la Empresa">
                  <Input
                    value={getVal("empresa_nombre")}
                    onChange={(e) => setVal("empresa_nombre", e.target.value)}
                  />
                </Field>
                <Field label="RIF">
                  <Input
                    value={getVal("empresa_nit")}
                    onChange={(e) => setVal("empresa_nit", e.target.value)}
                  />
                </Field>
                <Field label="Direccion">
                  <Input
                    value={getVal("empresa_direccion")}
                    onChange={(e) => setVal("empresa_direccion", e.target.value)}
                  />
                </Field>
                <Field label="Ciudad">
                  <Input
                    value={getVal("empresa_ciudad")}
                    onChange={(e) => setVal("empresa_ciudad", e.target.value)}
                  />
                </Field>
                <Field label="Telefono">
                  <Input
                    value={getVal("empresa_telefono")}
                    onChange={(e) => setVal("empresa_telefono", e.target.value)}
                  />
                </Field>
                <Field label="Correo">
                  <Input
                    type="email"
                    value={getVal("empresa_email")}
                    onChange={(e) => setVal("empresa_email", e.target.value)}
                  />
                </Field>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Configuracion de Inventario</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-foreground">Existencias mínimas por defecto</span>
                <Input
                  type="number"
                  value={getVal("inventario_stock_minimo")}
                  onChange={(e) => setVal("inventario_stock_minimo", e.target.value)}
                  className="w-32"
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-foreground">Metodo de costeo</span>
                <Select
                  value={getVal("inventario_metodo_costeo")}
                  onChange={(e) => setVal("inventario_metodo_costeo", e.target.value)}
                  className="w-64"
                >
                  <option value="FIFO">FIFO (Primeras entradas, primeras salidas)</option>
                  <option value="LIFO">LIFO (Ultimas entradas, primeras salidas)</option>
                  <option value="Promedio">Promedio ponderado</option>
                </Select>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-foreground">Alertas de existencias bajas</span>
                <div className="flex items-center gap-2">
                  <Switch
                    defaultChecked={getVal("inventario_alertas_stock") === "true"}
                    onCheckedChange={(checked) =>
                      setVal("inventario_alertas_stock", checked ? "true" : "false")
                    }
                  />
                  <span className="text-xs text-muted-foreground">
                    {getVal("inventario_alertas_stock") === "true" ? "Activado" : "Desactivado"}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <SlidersHorizontal size={16} /> Motor de Precios (CPP)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Reglas globales "set &amp; forget": se aplican automáticamente a cada compra y
                venta, sin que el operador configure nada por transacción.
              </p>

              {triangulacionIncompleta && (
                <div className="flex items-start gap-2 rounded-md border border-warning-border bg-warning-soft px-3 py-2 text-sm font-medium text-warning-strong">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                  <span>
                    La triangulación necesita una <strong>moneda de tránsito</strong>{" "}
                    {faltaTransitoCompras && faltaTransitoVentas
                      ? "(en compras y ventas)"
                      : faltaTransitoCompras
                        ? "(en compras)"
                        : "(en ventas)"}
                    . Sin ella se aplicaría la conversión directa.
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between gap-4">
                <div>
                  <span className="text-sm text-foreground">Conversión en compras</span>
                  <p className="text-xs text-muted-foreground">
                    Directa (moneda factura → base) o triangulación vía la moneda de tránsito.
                  </p>
                </div>
                <Select
                  value={globalCfg?.metodo_conversion_compras ?? "directa"}
                  onChange={(e) => setGlobal({ metodo_conversion_compras: e.target.value })}
                  className="w-52"
                >
                  <option value="directa">Directa</option>
                  <option value="triangulacion">Triangulación</option>
                </Select>
              </div>

              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-foreground">Moneda de tránsito (compras)</span>
                <Select
                  value={globalCfg?.moneda_transito_compras_id ?? ""}
                  onChange={(e) => setGlobal({ moneda_transito_compras_id: e.target.value || null })}
                  className="w-52"
                >
                  <option value="">— Sin tránsito —</option>
                  {monedas.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.codigo}
                      {m.nombre ? ` · ${m.nombre}` : ""}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <span className="text-sm text-foreground">Conversión en ventas</span>
                  <p className="text-xs text-muted-foreground">
                    Directa (moneda de venta → base) o triangulación vía la moneda de tránsito.
                  </p>
                </div>
                <Select
                  value={globalCfg?.metodo_conversion_ventas ?? "directa"}
                  onChange={(e) => setGlobal({ metodo_conversion_ventas: e.target.value })}
                  className="w-52"
                >
                  <option value="directa">Directa</option>
                  <option value="triangulacion">Triangulación</option>
                </Select>
              </div>

              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-foreground">Moneda de tránsito (ventas)</span>
                <Select
                  value={globalCfg?.moneda_transito_ventas_id ?? ""}
                  onChange={(e) => setGlobal({ moneda_transito_ventas_id: e.target.value || null })}
                  className="w-52"
                >
                  <option value="">— Sin tránsito —</option>
                  {monedas.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.codigo}
                      {m.nombre ? ` · ${m.nombre}` : ""}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="border-t pt-3" />

              <div className="flex items-center justify-between gap-4">
                <div>
                  <span className="text-sm text-foreground">Auto-precio tras compra</span>
                  <p className="text-xs text-muted-foreground">
                    Precio de venta = CPP × (1 + margen%) con el redondeo global.
                  </p>
                </div>
                <Switch
                  checked={globalCfg?.auto_precio_compra === true}
                  onCheckedChange={(c) => setGlobal({ auto_precio_compra: c })}
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-foreground">Redondeo de precios activo</span>
                <Switch
                  checked={globalCfg?.redondeo_activo === true}
                  onCheckedChange={(c) => setGlobal({ redondeo_activo: c })}
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-foreground">Múltiplo de redondeo</span>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={String(globalCfg?.redondeo_multiplo ?? 0)}
                  onChange={(e) => setGlobal({ redondeo_multiplo: Number(e.target.value) || 0 })}
                  className="w-32"
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <span className="text-sm text-foreground">No bajar del costo</span>
                  <p className="text-xs text-muted-foreground">
                    El redondeo nunca deja el precio por debajo del costo.
                  </p>
                </div>
                <Switch
                  checked={globalCfg?.redondeo_no_bajar_de_costo !== false}
                  onCheckedChange={(c) => setGlobal({ redondeo_no_bajar_de_costo: c })}
                />
              </div>

              <div className="flex items-center justify-between gap-3 border-t pt-3">
                <p className="text-xs text-muted-foreground">
                  Realinea los precios automáticos con el CPP y las reglas vigentes
                  (solo productos con precio automático).
                </p>
                <Button variant="outline" size="sm" onClick={handleRecalcular} disabled={recalculando}>
                  {recalculando ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  Recalcular
                </Button>
              </div>
              {recalcResult && <p className="text-xs text-success">{recalcResult}</p>}
            </CardContent>
          </Card>

          <CloudSyncCard />
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Perfil de Usuario</CardTitle>
            </CardHeader>
            <CardContent>
              {userData && (
                <>
                  <div className="mb-4 flex flex-col items-center gap-3">
                    <Avatar initials={userInitials(userData.name)} size="lg" />
                    <div className="text-center">
                      <div className="text-sm font-semibold">{userData.name}</div>
                      <div className="text-xs capitalize text-muted-foreground">{userData.role}</div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Input defaultValue={userData.email} disabled />
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center gap-2">
              <Database size={16} className="text-primary" />
              <CardTitle>Copia de Seguridad</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Exporta una copia completa de tu catálogo, clientes, inventario y ventas, o restaura un respaldo previo.
              </p>

              <div className="flex flex-col gap-2 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExportar}
                  disabled={exportando || importando}
                  className="w-full justify-start gap-2"
                >
                  {exportando ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                  Exportar Base de Datos (.json)
                </Button>

                <div>
                  <input
                    type="file"
                    id="db-backup-file-input"
                    accept=".json"
                    className="hidden"
                    onChange={handleSelectFile}
                    disabled={exportando || importando}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => document.getElementById("db-backup-file-input")?.click()}
                    disabled={exportando || importando}
                    className="w-full justify-start gap-2"
                  >
                    {importando ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                    Importar Base de Datos (.json)
                  </Button>
                </div>
              </div>

              {backupMsg && (
                <div
                  className={cn(
                    "rounded-md p-2.5 text-xs flex items-start gap-2",
                    backupMsg.tipo === "success"
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                      : "bg-destructive/10 text-destructive border border-destructive/20"
                  )}
                >
                  {backupMsg.tipo === "success" ? (
                    <Check size={14} className="shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  )}
                  <span>{backupMsg.texto}</span>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Informacion del Sistema</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
              <div className="flex justify-between">
                <span>Tecnología</span>
                <span className="font-mono font-medium text-foreground">Next.js 16</span>
              </div>
              <div className="flex justify-between">
                <span>Base de datos</span>
                <span className="font-mono font-medium text-foreground">PostgreSQL</span>
              </div>
              <div className="flex justify-between">
                <span>Autenticacion</span>
                <span className="font-mono font-medium text-foreground">Better Auth</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <Button size="lg" onClick={handleSave} disabled={!hasChanges || saving}>
          {saving ? (
            <>
              <Loader2 size={14} className="animate-spin" /> Guardando...
            </>
          ) : saved ? (
            <>
              <Check size={14} /> Guardado
            </>
          ) : (
            <>
              <Save size={14} /> Guardar Cambios
            </>
          )}
        </Button>
      </div>

      <Modal
        open={showConfirmModal}
        onClose={() => {
          if (!importando) {
            setShowConfirmModal(false);
            setPendingFile(null);
          }
        }}
        title="Restaurar Copia de Seguridad"
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowConfirmModal(false);
                setPendingFile(null);
              }}
              disabled={importando}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmarImportacion}
              disabled={importando}
            >
              {importando ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> Restaurando...
                </>
              ) : (
                "Reemplazar y Restaurar"
              )}
            </Button>
          </div>
        }
      >
        <div className="space-y-3 py-2 text-sm">
          <div className="flex items-start gap-3 rounded-md bg-amber-500/10 p-3 text-amber-600 dark:text-amber-400 border border-amber-500/20">
            <AlertTriangle size={20} className="shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">¡Atención: Acción destructiva!</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Al restaurar este archivo, la base de datos actual será reemplazada con la información del respaldo. Asegúrate de tener una copia reciente antes de continuar.
              </p>
            </div>
          </div>

          {pendingFile && (
            <div className="rounded-md border bg-muted/40 p-3 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Archivo:</span>
                <span className="font-medium text-foreground">{pendingFile.name}</span>
              </div>
              {pendingFile.content?.counts?.productos !== undefined && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Productos en respaldo:</span>
                  <span className="font-medium text-foreground">{pendingFile.content.counts.productos}</span>
                </div>
              )}
              {pendingFile.content?.fecha && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Fecha del respaldo:</span>
                  <span className="font-medium text-foreground">
                    {new Date(pendingFile.content.fecha).toLocaleString()}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
